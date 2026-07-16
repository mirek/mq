import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileExpression,
  evaluate,
  isMarkdownNode,
  nodeMarkdown,
  parse,
  toJsonValue,
  type Document,
  type QueryValue,
} from "../src/index.ts";

const parseDocument = (source: string): Document => {
  const result = parse(source, { path: "guide.md" });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("document did not parse");
  return result.value;
};

const run = (document: Document, source: string): readonly QueryValue[] => {
  const compiled = compileExpression(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("expression did not compile");
  return evaluate(document, compiled.value);
};

const source = [
  "lead",
  "# One",
  "one body",
  "## Two 😀",
  "two body",
  "# Three",
  "three body",
  "",
].join("\n");

describe("expression evaluation", () => {
  it("evaluates identity and selector stages as ordered node streams", () => {
    const document = parseDocument(source);
    const headings = run(document, 'select("heading")');

    assert.deepEqual(run(document, "."), [document]);
    assert.deepEqual(run(document, 'select("section[level=4]") | .'), []);
    assert.deepEqual(run(document, 'select("section[level=2]") | .'), [
      document.sections[0]?.sections[0],
    ]);
    assert.deepEqual(run(document, 'select("heading") | .'), headings);
    assert.deepEqual(run(document, 'select("section[level=4]")'), []);
    assert.deepEqual(
      run(document, 'select("section[level=2]")'),
      [document.sections[0]?.sections[0]],
    );
    assert.deepEqual(
      run(document, 'select("heading")'),
      [
        document.sections[0]?.heading,
        document.sections[0]?.sections[0]?.heading,
        document.sections[1]?.heading,
      ],
    );
  });

  it("fans out each input while preserving input and document order", () => {
    const document = parseDocument(source);
    const values = run(
      document,
      'select("section[level=1]") | select("heading") | text',
    );

    assert.deepEqual(values, ["One", "Two 😀", "Three"]);
  });

  it("projects zero, one, and many nodes to exact Markdown", () => {
    const document = parseDocument(source);

    assert.deepEqual(
      run(document, 'select("section[level=4]") | markdown'),
      [],
    );
    assert.deepEqual(
      run(document, 'select("heading[level=2]") | markdown'),
      ["## Two 😀\n"],
    );
    assert.deepEqual(
      run(document, 'select("heading") | markdown'),
      ["# One\n", "## Two 😀\n", "# Three\n"],
    );
    assert.deepEqual(run(document, ". | markdown"), [source]);
  });

  it("projects recursive plain text for zero, one, and many nodes", () => {
    const document = parseDocument(source);

    assert.deepEqual(run(document, 'select("section[level=4]") | text'), []);
    assert.deepEqual(run(document, 'select("heading[level=2]") | text'), [
      "Two 😀",
    ]);
    assert.deepEqual(run(document, 'select("heading") | text'), [
      "One",
      "Two 😀",
      "Three",
    ]);
    assert.deepEqual(run(document, 'select("section[level=2]") | text'), [
      "Two 😀\ntwo body",
    ]);
    assert.deepEqual(run(document, ". | text"), [
      "lead\nOne\none body\nTwo 😀\ntwo body\nThree\nthree body",
    ]);
  });

  it("projects stable frozen JSON values for zero, one, and many nodes", () => {
    const document = parseDocument(source);

    assert.deepEqual(run(document, 'select("section[level=4]") | json'), []);
    assert.deepEqual(run(document, 'select("heading[level=2]") | json'), [
      { level: 2, style: "atx", title: "Two 😀", type: "heading" },
    ]);

    const values = run(document, 'select("heading") | json');
    assert.equal(values.length, 3);
    assert.equal(Object.isFrozen(values), true);
    assert.equal(Object.isFrozen(values[0]), true);
    assert.equal(
      JSON.stringify(values[0]),
      '{"level":1,"style":"atx","title":"One","type":"heading"}',
    );
  });

  it("uses stable semantic JSON shapes for every recognized block kind", () => {
    const document = parseDocument("lead\n\n> retained\n");
    const values = run(document, ". | json");

    assert.equal(
      JSON.stringify(values),
      '[{"children":[{"text":"lead","type":"paragraph"},{"type":"blank-line"},{"markdown":"> retained\\n","reason":"unsupported-block","type":"opaque"}],"path":"guide.md","type":"document"}]',
    );
    assert.equal(Object.isFrozen(values[0]), true);
    const jsonDocument = values[0] as { readonly children: readonly unknown[] };
    assert.equal(Object.isFrozen(jsonDocument.children), true);
    assert.equal(Object.isFrozen(jsonDocument.children[0]), true);
  });

  it("reduces zero, one, and many incoming values with count", () => {
    const document = parseDocument(source);

    assert.deepEqual(run(document, 'select("section[level=4]") | count'), [0]);
    assert.deepEqual(run(document, ". | count"), [1]);
    assert.deepEqual(run(document, 'select("heading") | count'), [3]);
  });

  it("reduces zero, one, and many incoming values with first and last", () => {
    const document = parseDocument(source);
    const headings = run(document, 'select("heading")');

    assert.deepEqual(run(document, 'select("section[level=4]") | first'), []);
    assert.deepEqual(run(document, ". | first"), [document]);
    assert.deepEqual(run(document, 'select("heading") | first'), [headings[0]]);
    assert.deepEqual(run(document, 'select("section[level=4]") | last'), []);
    assert.deepEqual(run(document, ". | last"), [document]);
    assert.deepEqual(run(document, 'select("heading") | last'), [headings[2]]);
  });

  it("collects zero, one, and many incoming values into immutable arrays", () => {
    const document = parseDocument(source);
    const headings = run(document, 'select("heading")');

    const empty = run(document, 'select("section[level=4]") | array');
    const one = run(document, ". | array");
    const many = run(document, 'select("heading") | array');
    assert.deepEqual(empty, [[]]);
    assert.deepEqual(one, [[document]]);
    assert.deepEqual(many, [headings]);
    assert.equal(Object.isFrozen(empty[0]), true);
    assert.equal(Object.isFrozen(one[0]), true);
    assert.equal(Object.isFrozen(many[0]), true);
  });

  it("serializes collected nodes recursively and filters incompatible values", () => {
    const document = parseDocument(source);
    const values = run(document, 'select("heading") | array | json');

    assert.equal(Object.isFrozen(values[0]), true);
    assert.equal(Object.isFrozen((values[0] as readonly QueryValue[])[0]), true);
    assert.equal(
      JSON.stringify(values),
      '[[{"level":1,"style":"atx","title":"One","type":"heading"},{"level":2,"style":"atx","title":"Two 😀","type":"heading"},{"level":1,"style":"atx","title":"Three","type":"heading"}]]',
    );
    assert.deepEqual(run(document, "count | markdown"), []);
    assert.deepEqual(run(document, "array | select(\"heading\")"), []);
  });

  it("rejects expression objects not produced by the compiler", () => {
    const document = parseDocument(source);

    assert.throws(
      () => evaluate(document, { source: "." }),
      /expression must be produced by compileExpression/,
    );
  });

  it("exposes the evaluator's node output contracts to adapters", () => {
    const document = parseDocument(source);
    const heading = document.sections[0]!.sections[0]!.heading;

    assert.equal(isMarkdownNode(heading), true);
    assert.equal(isMarkdownNode("heading"), false);
    assert.equal(nodeMarkdown(document, heading), "## Two 😀\n");
    assert.deepEqual(toJsonValue(document, heading), {
      level: 2,
      style: "atx",
      title: "Two 😀",
      type: "heading",
    });
  });
});
