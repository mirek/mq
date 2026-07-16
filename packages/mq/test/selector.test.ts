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

const completeSource = [
  "# One",
  "lead alpha",
  "## Two",
  "second beta",
  "### Three",
  "third alpha",
  "## API Reference",
  "fourth gamma",
  "",
  "- first alpha",
  "- second beta",
  "- third gamma",
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

describe("complete selector language", () => {
  it("supports presence, string, inequality, and ordered attribute operators", () => {
    assert.deepEqual(
      query(completeSource, "heading[level>=2][level<3]").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["Two", "API Reference"],
    );
    assert.deepEqual(
      query(completeSource, "heading[level>1][level<=2]").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["Two", "API Reference"],
    );
    assert.deepEqual(
      query(
        completeSource,
        "heading[title^=API][title$=Reference][title*=Ref]",
      ).map((node) => node.type === "heading" && node.title),
      ["API Reference"],
    );
    assert.deepEqual(
      query(completeSource, "heading[title~=Reference][title!=Two]").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["API Reference"],
    );
    assert.equal(
      query("- [x] done\n- [ ] pending\n- ordinary\n", "item[checked]")
        .length,
      2,
    );
  });

  it("supports selector lists and sibling combinators without duplicates", () => {
    const siblingSource = "# Root\n## A\n## B\n## C\n";
    assert.deepEqual(
      query(siblingSource, "section[title=A] + section").map(
        (node) => node.type === "section" && node.title,
      ),
      ["B"],
    );
    assert.deepEqual(
      query(siblingSource, "section[title=A] ~ section").map(
        (node) => node.type === "section" && node.title,
      ),
      ["B", "C"],
    );
    assert.deepEqual(
      query(completeSource, "heading, section heading").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["One", "Two", "Three", "API Reference"],
    );
  });

  it("supports structural, text, regex, relational, and negation pseudos", () => {
    assert.deepEqual(
      query(
        completeSource,
        "item:first-child, item:nth-child(2), item:last-child",
      ).map(
        (node) =>
          node.type === "item" &&
          node.children[0]?.type === "paragraph" &&
          node.children[0].text,
      ),
      ["first alpha", "second beta", "third gamma"],
    );
    assert.deepEqual(
      query(completeSource, 'item:contains("second beta")').map(
        (node) =>
          node.type === "item" &&
          node.children[0]?.type === "paragraph" &&
          node.children[0].text,
      ),
      ["second beta"],
    );
    assert.equal(
      query(completeSource, "item:matches(/^SECOND\\s+BETA$/i)").length,
      1,
    );
    assert.deepEqual(
      query(completeSource, "section:has(> heading[title=Two])").map(
        (node) => node.type === "section" && node.title,
      ),
      ["Two"],
    );
    assert.deepEqual(
      query(completeSource, "heading:not([level=1])").map(
        (node) => node.type === "heading" && node.title,
      ),
      ["Two", "Three", "API Reference"],
    );
  });

  it("evaluates adversarial patterns with a linear-time regex engine", () => {
    const adversarialSource = `${"a".repeat(20_000)}!\n`;
    assert.deepEqual(
      query(adversarialSource, "paragraph:matches(/^(a+)+$/)"),
      [],
    );
  });

  it("returns stable diagnostics for typed, regex, and nested syntax errors", () => {
    for (const selector of ["heading[level^=2]", "heading[title>foo]"]) {
      const result = compileSelector(selector);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.diagnostics[0].code, "selector.attribute-type");
      }
    }

    for (const selector of [
      "paragraph:matches(/x/g)",
      "paragraph:matches(/(?=x)/)",
      "paragraph:matches(/[/)",
      `paragraph:matches(/${"x".repeat(257)}/)`,
    ]) {
      const result = compileSelector(selector);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.diagnostics[0].code, "selector.regex");
      }
    }

    for (const selector of [
      "item:nth-child(0)",
      "section:has(>)",
      "heading:not(> paragraph)",
      "heading,",
    ]) {
      const result = compileSelector(selector);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.diagnostics[0].code, "selector.syntax");
      }
    }
  });
});
