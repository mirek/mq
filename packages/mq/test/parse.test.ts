import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse } from "../src/index.ts";

describe("parse", () => {
  it("recognizes initial lossless blocks and source metadata", () => {
    const source =
      "\uFEFF   ### Café ###  \r\n\r\nBody line one\nBody line two\r\r\nInstall\r\n=======\r\n> deferred\r\n";

    const result = parse(source, { path: "guide.md" });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.path, "guide.md");
    assert.deepEqual(result.value.source, {
      text: source,
      byteLength: Buffer.byteLength(source),
      bom: {
        start: { byteOffset: 0, line: 1, column: 1, utf16Column: 1 },
        end: { byteOffset: 3, line: 1, column: 1, utf16Column: 1 },
      },
      dominantNewline: "\r\n",
      mixedNewlines: [
        {
          style: "\n",
          range: {
            start: { byteOffset: 38, line: 3, column: 14, utf16Column: 14 },
            end: { byteOffset: 39, line: 4, column: 1, utf16Column: 1 },
          },
        },
        {
          style: "\r",
          range: {
            start: { byteOffset: 52, line: 4, column: 14, utf16Column: 14 },
            end: { byteOffset: 53, line: 5, column: 1, utf16Column: 1 },
          },
        },
      ],
      hasFinalNewline: true,
    });

    assert.deepEqual(
      result.value.cst.children.map(({ kind, range }) => ({
        kind,
        bytes: [range.start.byteOffset, range.end.byteOffset],
      })),
      [
        { kind: "bom", bytes: [0, 3] },
        { kind: "atx-heading", bytes: [3, 23] },
        { kind: "blank-line", bytes: [23, 25] },
        { kind: "paragraph", bytes: [25, 53] },
        { kind: "blank-line", bytes: [53, 55] },
        { kind: "setext-heading", bytes: [55, 73] },
        { kind: "opaque", bytes: [73, 85] },
      ],
    );

    assert.deepEqual(result.value.diagnostics, [
      {
        code: "markdown.opaque-block",
        severity: "warning",
        message: "Preserved an unsupported Markdown block as opaque source.",
        source: "markdown",
        path: "guide.md",
        range: result.value.cst.children.at(-1)?.range,
      },
    ]);
    assert.deepEqual(
      result.value.sections.map(({ level, title }) => ({ level, title })),
      [
        { level: 3, title: "Café" },
        { level: 1, title: "Install" },
      ],
    );

    const reconstructed = result.value.cst.children
      .map(({ range }) =>
        Buffer.from(source).subarray(
          range.start.byteOffset,
          range.end.byteOffset,
        ),
      )
      .reduce((left, right) => Buffer.concat([left, right]), Buffer.alloc(0));

    assert.equal(reconstructed.toString(), source);
  });

  it("distinguishes ATX syntax from paragraph text", () => {
    const result = parse("#No heading\n###### Valid\n####### paragraph\n");

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      result.value.cst.children.map(({ kind }) => kind),
      ["paragraph", "atx-heading", "paragraph"],
    );
  });

  it("uses the first newline style to break frequency ties", () => {
    const result = parse("one\r\ntwo\n");

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.source.dominantNewline, "\r\n");
    assert.equal(result.value.source.mixedNewlines.length, 1);
    assert.equal(result.value.source.hasFinalNewline, true);
  });

  it("keeps fenced content in one opaque block", () => {
    const result = parse("```md\n# not a heading\n```\n# heading");

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      result.value.cst.children.map(({ kind }) => kind),
      ["opaque", "atx-heading"],
    );
    assert.equal(result.value.diagnostics.length, 1);
    assert.equal(result.value.source.hasFinalNewline, false);
  });

  it("derives nested sections for skipped and repeated heading ranks", () => {
    const source = [
      "lead",
      "# A",
      "intro",
      "### C",
      "text",
      "## B",
      "body",
      "## B2",
      "# D",
      "tail",
    ].join("\n");

    const result = parse(source);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const [a, d] = result.value.sections;
    assert.deepEqual(result.value.children.map(({ type }) => type), [
      "paragraph",
      "section",
      "section",
    ]);
    assert.deepEqual(result.value.preamble.map(({ type }) => type), [
      "paragraph",
    ]);
    assert.deepEqual(
      result.value.sections.map(({ level, title }) => ({ level, title })),
      [
        { level: 1, title: "A" },
        { level: 1, title: "D" },
      ],
    );
    assert.deepEqual(
      a?.sections.map(({ level, title }) => ({ level, title })),
      [
        { level: 3, title: "C" },
        { level: 2, title: "B" },
        { level: 2, title: "B2" },
      ],
    );
    assert.deepEqual(a?.children.map(({ type }) => type), [
      "heading",
      "paragraph",
      "section",
      "section",
      "section",
    ]);
    assert.deepEqual(a?.sections.map(({ body }) => body.length), [1, 1, 0]);
    assert.equal(a?.body.length, 1);
    assert.equal(d?.body.length, 1);
    assert.deepEqual(
      [a, ...(a?.sections ?? []), d].map((section) => [
        section?.range.start.byteOffset,
        section?.range.end.byteOffset,
      ]),
      [
        [source.indexOf("# A"), source.indexOf("# D")],
        [source.indexOf("### C"), source.indexOf("## B")],
        [source.indexOf("## B"), source.indexOf("## B2")],
        [source.indexOf("## B2"), source.indexOf("# D")],
        [source.indexOf("# D"), Buffer.byteLength(source)],
      ],
    );
  });

  it("keeps skipped top-level ranks and section collections immutable", () => {
    const source = "### Orphan\nbody\n# Root\n";
    const result = parse(source);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      result.value.sections.map(({ level, title }) => ({ level, title })),
      [
        { level: 3, title: "Orphan" },
        { level: 1, title: "Root" },
      ],
    );
    assert.equal(Object.isFrozen(result.value.sections), true);
    assert.equal(Object.isFrozen(result.value.sections[0]), true);
    assert.equal(Object.isFrozen(result.value.sections[0]?.body), true);
    assert.equal(Object.isFrozen(result.value.sections[0]?.children), true);
  });
});
