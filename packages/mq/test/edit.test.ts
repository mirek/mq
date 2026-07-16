import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  afterEdit,
  appendEdit,
  applySourcePatches,
  beforeEdit,
  compileSelector,
  parse,
  parseMarkdownFragment,
  planEdits,
  prependEdit,
  removeEdit,
  replaceEdit,
  setAttributeEdit,
  setTitleEdit,
  type CompiledSelector,
  type Document,
  type MarkdownFragment,
} from "../src/index.ts";

const document = (source: string): Document => {
  const parsed = parse(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture must parse");
  return parsed.value;
};

const selector = (source: string): CompiledSelector => {
  const compiled = compileSelector(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("fixture selector must compile");
  return compiled.value;
};

const fragment = (source: string): MarkdownFragment => {
  const parsed = parseMarkdownFragment(source);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture fragment must parse");
  return parsed.value;
};

const apply = (
  source: string,
  operations: Parameters<typeof planEdits>[1],
): string => {
  const planned = planEdits(document(source), operations);
  assert.equal(planned.ok, true);
  if (!planned.ok) return source;
  return applySourcePatches(planned.value).text;
};

const source = [
  "# Project",
  "intro",
  "## Setup",
  "old",
  "## Examples",
  "tail",
  "",
].join("\n");

describe("edit operation patch planning", () => {
  it("plans replace and remove against the original snapshot", () => {
    assert.equal(
      apply(source, [
        replaceEdit(selector("section[title=Setup] > paragraph"), fragment("new")),
      ]),
      source.replace("old\n", "new\n"),
    );
    assert.equal(
      apply(source, [removeEdit(selector("section[title=Setup]"))]),
      "# Project\nintro\n## Examples\ntail\n",
    );
  });

  it("plans before, after, prepend, and append with fragment boundaries", () => {
    assert.equal(
      apply(source, [
        beforeEdit(selector("section[title=Setup]"), fragment("> before")),
      ]),
      source.replace("## Setup", "> before\n## Setup"),
    );
    assert.equal(
      apply(source, [
        afterEdit(selector("section[title=Setup]"), fragment("> after")),
      ]),
      source.replace("## Examples", "> after\n## Examples"),
    );
    assert.equal(
      apply(source, [
        prependEdit(selector("section[title=Examples]"), fragment("first")),
      ]),
      source.replace("## Examples\n", "## Examples\nfirst\n"),
    );
    assert.equal(
      apply(source, [
        appendEdit(selector("section[title=Examples]"), fragment("last")),
      ]),
      `${source}last`,
    );
    assert.equal(
      apply("---\nname: mq\n---\n# A\n", [
        prependEdit(selector("document"), fragment("lead")),
      ]),
      "---\nname: mq\n---\nlead\n# A\n",
    );
  });

  it("changes only heading title source and escapes plain Markdown text", () => {
    assert.equal(
      apply(source, [
        setTitleEdit(selector("section[title=Setup]"), "Install *now*"),
      ]),
      source.replace("## Setup", "## Install \\*now\\*"),
    );
  });

  it("updates source-local heading levels and existing task markers", () => {
    assert.equal(
      apply("## Setup ##\n", [
        setAttributeEdit(selector("heading"), "level", 3),
      ]),
      "### Setup ##\n",
    );
    assert.equal(
      apply("- [ ] todo\n", [
        setAttributeEdit(selector("item[checked=false]"), "checked", true),
      ]),
      "- [x] todo\n",
    );
  });

  it("rejects cross-operation overlaps before producing a plan", () => {
    const planned = planEdits(document(source), [
      replaceEdit(selector("section[title=Setup]"), fragment("replacement")),
      replaceEdit(
        selector("section[title=Setup] > paragraph"),
        fragment("nested"),
      ),
    ]);
    assert.equal(planned.ok, false);
    if (!planned.ok) {
      assert.equal(planned.diagnostics[0].code, "edit.patch-overlap");
    }
  });

  it("rejects unsupported operation targets and attributes", () => {
    const target = planEdits(document(source), [
      appendEdit(selector("paragraph"), fragment("nope")),
    ]);
    assert.equal(target.ok, false);
    if (!target.ok) assert.equal(target.diagnostics[0].code, "edit.target");

    const attribute = planEdits(document("Title\n=====\n"), [
      setAttributeEdit(selector("heading"), "level", 3),
    ]);
    assert.equal(attribute.ok, false);
    if (!attribute.ok) {
      assert.equal(attribute.diagnostics[0].code, "edit.attribute");
    }
  });
});
