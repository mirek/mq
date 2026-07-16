import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileSelector,
  parse,
  render,
  select,
  type CompiledSelector,
  type MarkdownNode,
  type Result,
} from "../src/index.ts";

const query = (source: string, selectorSource: string): readonly MarkdownNode[] => {
  const parsed = parse(source, { path: "guide.md" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return [];

  const compiled: Result<CompiledSelector> = compileSelector(selectorSource);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return [];

  return select(parsed.value, compiled.value);
};

const source = [
  "preamble",
  "# Guide",
  "introduction",
  "## Installation",
  "install body",
  "### Linux",
  "linux body",
  "## API",
  "api body",
].join("\n");

describe("core selectors", () => {
  it("executes the specification's section query in source order", () => {
    const matches = query(source, "section[level=2]");

    assert.deepEqual(
      matches.map((node) => node.type === "section" && node.title),
      ["Installation", "API"],
    );
  });

  it("supports document, universal, type, child, and descendant selectors", () => {
    assert.deepEqual(
      query(source, "document > section").map((node) => node.type),
      ["section"],
    );
    assert.deepEqual(
      query(source, 'section[title="Installation"] > heading').map(
        (node) => node.type === "heading" && node.title,
      ),
      ["Installation"],
    );
    assert.deepEqual(
      query(source, "section[title=Installation] paragraph").map(
        ({ type }) => type,
      ),
      ["paragraph", "paragraph"],
    );

    const everyNode = query("# A\nbody", "*");
    assert.deepEqual(
      everyNode.map(({ type }) => type),
      ["document", "section", "heading", "text", "paragraph", "text"],
    );
  });

  it("matches type and attribute names case-insensitively and values exactly", () => {
    assert.deepEqual(
      query(source, 'SECTION[TiTlE="Installation"]').map(
        (node) => node.type === "section" && node.title,
      ),
      ["Installation"],
    );
    assert.deepEqual(query(source, 'section[title="installation"]'), []);
    assert.deepEqual(
      query(source, "heading[style=atx][slug=installation]").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["Installation"],
    );
    assert.deepEqual(
      query(source, 'document[path="guide.md"]').map(({ type }) => type),
      ["document"],
    );
  });

  it("returns immutable compiled selectors and immutable deduplicated matches", () => {
    const parsed = parse("# A\n## B\n");
    const compiled = compileSelector("section section");
    assert.equal(parsed.ok, true);
    assert.equal(compiled.ok, true);
    if (!parsed.ok || !compiled.ok) return;

    assert.equal(compiled.value.source, "section section");
    assert.equal(Object.isFrozen(compiled.value), true);

    const matches = select(parsed.value, compiled.value);
    assert.deepEqual(
      matches.map((node) => node.type === "section" && node.title),
      ["B"],
    );
    assert.equal(Object.isFrozen(matches), true);
    const documentSelector = compileSelector("document");
    assert.equal(documentSelector.ok, true);
    if (!documentSelector.ok) return;
    assert.deepEqual(
      select(parsed.value, documentSelector.value, { includeRoot: false }),
      [],
    );
    assert.equal(render(parsed.value), "# A\n## B\n");
  });

  it("returns selector syntax and attribute type failures as diagnostics", () => {
    const syntax = compileSelector("section[=2]");
    assert.equal(syntax.ok, false);
    if (syntax.ok) return;
    assert.equal(syntax.diagnostics[0].code, "selector.syntax");
    assert.equal(syntax.diagnostics[0].source, "selector");
    assert.deepEqual(
      [
        syntax.diagnostics[0].range?.start.byteOffset,
        syntax.diagnostics[0].range?.end.byteOffset,
      ],
      [0, Buffer.byteLength("section[=2]")],
    );

    const type = compileSelector("section[level=two]");
    assert.equal(type.ok, false);
    if (type.ok) return;
    assert.equal(type.diagnostics[0].code, "selector.attribute-type");
    assert.equal(type.diagnostics[0].source, "selector");
    assert.equal(Object.isFrozen(type.diagnostics), true);
  });
});
