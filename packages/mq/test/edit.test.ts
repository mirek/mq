import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  afterEdit,
  appendEdit,
  applyEdits,
  applySourcePatches,
  beforeEdit,
  compileSelector,
  parse,
  parseMarkdownFragment,
  planEdits,
  prependEdit,
  removeEdit,
  render,
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

  for (const newline of ["\n", "\r\n"] as const) {
    for (const fixture of [
      {
        name: "blockquote",
        source: `> target${newline}`,
        target: "blockquote > paragraph",
        continuation: "> ",
        before: `> ## inserted${newline}> target${newline}`,
        after: `> target${newline}> ## inserted${newline}`,
        replacement: `> first${newline}> second${newline}`,
        children(snapshot: Document) {
          const quote = snapshot.preamble[0];
          assert.equal(quote?.type, "blockquote");
          if (quote?.type !== "blockquote") return [];
          return quote.children;
        },
      },
      {
        name: "list item",
        source: `- target${newline}`,
        target: "item > paragraph",
        continuation: "  ",
        before: `- ## inserted${newline}  target${newline}`,
        after: `- target${newline}  ## inserted${newline}`,
        replacement: `- first${newline}  second${newline}`,
        children(snapshot: Document) {
          const list = snapshot.preamble[0];
          assert.equal(list?.type, "list");
          if (list?.type !== "list") return [];
          return list.children[0]?.children ?? [];
        },
      },
    ] as const) {
      it(`preserves the ${fixture.name} for fragment edits with ${newline === "\n" ? "LF" : "CRLF"}`, () => {
        const cases = [
          {
            operation: beforeEdit(selector(fixture.target), fragment("## inserted")),
            expected: fixture.before,
            replacement: `## inserted${newline}${fixture.continuation}`,
            range: [2, 2],
            types: ["heading", "paragraph"],
          },
          {
            operation: afterEdit(selector(fixture.target), fragment("## inserted")),
            expected: fixture.after,
            replacement: `${newline}${fixture.continuation}## inserted`,
            range: [8, 8],
            types: ["paragraph", "heading"],
          },
          {
            operation: replaceEdit(
              selector(fixture.target),
              fragment(`first${newline}second`),
            ),
            expected: fixture.replacement,
            replacement: `first${newline}${fixture.continuation}second`,
            range: [2, 8],
            types: ["paragraph"],
          },
        ] as const;

        for (const testCase of cases) {
          const input = document(fixture.source);
          const planned = planEdits(input, [testCase.operation]);
          assert.equal(planned.ok, true);
          if (!planned.ok) continue;
          assert.equal(planned.value.patches.length, 1);
          assert.deepEqual(
            [
              planned.value.patches[0]?.range.start.byteOffset,
              planned.value.patches[0]?.range.end.byteOffset,
            ],
            testCase.range,
          );
          assert.equal(planned.value.patches[0]?.replacement, testCase.replacement);

          const edited = applyEdits(input, [testCase.operation]);
          assert.equal(edited.ok, true);
          if (!edited.ok) continue;
          assert.equal(render(edited.value), testCase.expected);
          assert.equal(render(edited.value), edited.value.source.text);
          assert.deepEqual(
            fixture.children(edited.value).map(({ type }) => type),
            testCase.types,
          );
          const paragraph = fixture
            .children(edited.value)
            .find(({ type }) => type === "paragraph");
          if (testCase.types.length === 1) {
            assert.equal(
              paragraph?.type === "paragraph" ? paragraph.text : undefined,
              `first${newline}second`,
            );
          }
        }
      });
    }
  }

  it("rejects inline targets for block fragment operations", () => {
    for (const operation of [replaceEdit, beforeEdit, afterEdit]) {
      const planned = planEdits(document("a *target* here\n"), [
        operation(selector("emphasis"), fragment("replacement")),
      ]);
      assert.equal(planned.ok, false);
      if (!planned.ok) assert.equal(planned.diagnostics[0]?.code, "edit.target");
    }
  });

  it("composes continuation prefixes for nested and task-list containers", () => {
    assert.equal(
      apply("> - target\n", [
        replaceEdit(selector("item > paragraph"), fragment("first\nsecond")),
      ]),
      "> - first\n>   second\n",
    );
    assert.equal(
      apply("- [ ] target\n", [
        replaceEdit(selector("item > paragraph"), fragment("first\nsecond")),
      ]),
      "- [ ] first\n  second\n",
    );
  });
});
