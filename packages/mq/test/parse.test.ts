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
});
