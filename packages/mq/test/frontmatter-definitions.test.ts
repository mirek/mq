import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileExpression,
  compileSelector,
  evaluate,
  nodeMarkdown,
  parse,
  render,
  select,
} from "../src/index.ts";

describe("frontmatter and definitions", () => {
  it("recognizes YAML, TOML, and line-fenced JSON frontmatter losslessly", () => {
    const cases = [
      {
        format: "yaml",
        source: "---\nname: mq\n---\nbody\n",
        value: "name: mq",
      },
      {
        format: "toml",
        source: '+++\ntitle = "mq"\n+++\nbody\n',
        value: 'title = "mq"',
      },
      {
        format: "json",
        source: '{\n  "title": "mq"\n}\nbody\n',
        value: '  "title": "mq"',
      },
    ] as const;

    for (const { format, source, value } of cases) {
      const parsed = parse(source);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) continue;

      const matter = parsed.value.preamble[0];
      assert.equal(matter?.type, "frontmatter");
      if (matter?.type !== "frontmatter") continue;
      assert.equal(matter.format, format);
      assert.equal(matter.value, value);
      assert.equal(nodeMarkdown(parsed.value, matter), source.slice(0, source.indexOf("body")));
      assert.equal(matter.concrete.kind, "frontmatter");
      assert.equal(render(parsed.value), source);
      assert.deepEqual(parsed.value.diagnostics, []);
    }
  });

  it("accepts frontmatter after a BOM and only at the document head", () => {
    const withBom = "\uFEFF---\r\ntitle: mq\r\n---\r\n# Guide\r\n";
    const parsed = parse(withBom);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.preamble[0]?.type, "frontmatter");
    assert.deepEqual(parsed.value.cst.children.map(({ kind }) => kind), [
      "bom",
      "frontmatter",
      "atx-heading",
    ]);
    assert.equal(render(parsed.value), withBom);

    for (const source of [
      "before\n\n---\nname: mq\n---\n",
      "> ---\n> name: mq\n> ---\n",
      "---\nname: mq\n",
      '{"name":"mq"}\nbody\n',
    ]) {
      const boundary = parse(source);
      assert.equal(boundary.ok, true);
      if (!boundary.ok) continue;
      assert.equal(
        boundary.value.preamble.some(({ type }) => type === "frontmatter"),
        false,
      );
      assert.equal(render(boundary.value), source);
    }
  });

  it("retains reference definitions as semantic nodes with concrete syntax", () => {
    const source = [
      "See [the docs][Docs].",
      "",
      '[Docs]: </guide> "Guide title"',
      "",
    ].join("\n");
    const parsed = parse(source);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const definition = parsed.value.preamble.find(
      ({ type }) => type === "definition",
    );
    assert.equal(definition?.type, "definition");
    if (definition?.type !== "definition") return;
    assert.equal(definition.reference, "docs");
    assert.equal(definition.label, "Docs");
    assert.equal(definition.destination, "/guide");
    assert.equal(definition.title, "Guide title");
    assert.equal(definition.concrete.kind, "definition");
    assert.equal(nodeMarkdown(parsed.value, definition), '[Docs]: </guide> "Guide title"\n');
    assert.equal(render(parsed.value), source);
    assert.deepEqual(parsed.value.diagnostics, []);
  });

  it("selects formats and definitions and emits their semantic JSON shapes", () => {
    const source = "---\nname: mq\n---\n[Docs]: /guide\n";
    const parsed = parse(source);
    const matterSelector = compileSelector("frontmatter[format=yaml]");
    const definitionSelector = compileSelector(
      "definition[reference=docs][destination=/guide]",
    );
    const expression = compileExpression(
      'select("definition[reference=docs]") | json',
    );
    assert.equal(parsed.ok, true);
    assert.equal(matterSelector.ok, true);
    assert.equal(definitionSelector.ok, true);
    assert.equal(expression.ok, true);
    if (
      !parsed.ok ||
      !matterSelector.ok ||
      !definitionSelector.ok ||
      !expression.ok
    ) {
      return;
    }

    assert.equal(select(parsed.value, matterSelector.value).length, 1);
    assert.equal(select(parsed.value, definitionSelector.value).length, 1);
    assert.deepEqual(evaluate(parsed.value, expression.value), [
      {
        destination: "/guide",
        label: "Docs",
        reference: "docs",
        type: "definition",
      },
    ]);
  });
});
