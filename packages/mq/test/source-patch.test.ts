import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySourcePatches,
  planSourcePatches,
  sourcePosition,
  sourceRange,
  type SourcePatch,
} from "../src/index.ts";

const patchRange = (
  startByte: number,
  endByte: number,
  line = 1,
): SourcePatch["range"] =>
  sourceRange(
    sourcePosition(startByte, line, startByte + 1),
    sourcePosition(endByte, line, endByte + 1),
  );

describe("source patch plans", () => {
  it("sorts patches by original UTF-8 ranges and applies Unicode replacements", () => {
    const source = "α-one\nβ-two\n";
    const patches: SourcePatch[] = [
      {
        range: sourceRange(
          sourcePosition(10, 2, 3),
          sourcePosition(13, 2, 6),
        ),
        replacement: "TWO",
      },
      {
        range: sourceRange(
          sourcePosition(3, 1, 3),
          sourcePosition(6, 1, 6),
        ),
        replacement: "ONE",
      },
    ];

    const planned = planSourcePatches(source, patches);
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.deepEqual(
      planned.value.patches.map(({ range }) => range.start.byteOffset),
      [3, 10],
    );
    assert.equal(Object.isFrozen(planned.value.patches), true);

    const applied = applySourcePatches(planned.value);
    assert.equal(applied.text, "α-ONE\nβ-TWO\n");
    assert.equal(applied.byteLength, Buffer.byteLength(applied.text));
    assert.deepEqual(
      applied.map.segments.map(({ kind, original, generated }) => ({
        kind,
        original: [original.start.byteOffset, original.end.byteOffset],
        generated: [generated.start.byteOffset, generated.end.byteOffset],
      })),
      [
        { kind: "retained", original: [0, 3], generated: [0, 3] },
        { kind: "replacement", original: [3, 6], generated: [3, 6] },
        { kind: "retained", original: [6, 10], generated: [6, 10] },
        { kind: "replacement", original: [10, 13], generated: [10, 13] },
        { kind: "retained", original: [13, 14], generated: [13, 14] },
      ],
    );
    assert.equal(Object.isFrozen(applied.map.segments), true);
  });

  it("maps deletions, insertions, and shifted retained ranges", () => {
    const source = "abc\ndef\n";
    const planned = planSourcePatches(source, [
      {
        range: sourceRange(
          sourcePosition(4, 2, 1),
          sourcePosition(4, 2, 1),
        ),
        replacement: "X\n",
      },
      { range: patchRange(1, 2), replacement: "" },
    ]);
    assert.equal(planned.ok, true);
    if (!planned.ok) return;

    const applied = applySourcePatches(planned.value);
    assert.equal(applied.text, "ac\nX\ndef\n");
    assert.deepEqual(
      applied.map.segments.map(({ kind, original, generated }) => [
        kind,
        original.start.byteOffset,
        original.end.byteOffset,
        generated.start.byteOffset,
        generated.end.byteOffset,
      ]),
      [
        ["retained", 0, 1, 0, 1],
        ["replacement", 1, 2, 1, 1],
        ["retained", 2, 4, 1, 3],
        ["replacement", 4, 4, 3, 5],
        ["retained", 4, 8, 5, 9],
      ],
    );
    const shifted = applied.map.segments.at(-1);
    assert.equal(shifted?.original.start.line, 2);
    assert.equal(shifted?.original.start.column, 1);
    assert.equal(shifted?.generated.start.line, 3);
    assert.equal(shifted?.generated.start.column, 1);
  });

  it("rejects overlaps and ambiguous insertions before output exists", () => {
    const overlap = planSourcePatches("abcdef", [
      { range: patchRange(1, 4), replacement: "x" },
      { range: patchRange(3, 5), replacement: "y" },
    ]);
    assert.equal(overlap.ok, false);
    if (!overlap.ok) {
      assert.equal(overlap.diagnostics[0].code, "edit.patch-overlap");
      assert.equal(overlap.diagnostics[0].notes?.length, 2);
    }

    for (const patches of [
      [
        { range: patchRange(2, 2), replacement: "x" },
        { range: patchRange(2, 2), replacement: "y" },
      ],
      [
        { range: patchRange(1, 1), replacement: "x" },
        { range: patchRange(1, 3), replacement: "y" },
      ],
    ]) {
      const ambiguous = planSourcePatches("abcdef", patches);
      assert.equal(ambiguous.ok, false);
      if (!ambiguous.ok) {
        assert.equal(ambiguous.diagnostics[0].code, "edit.patch-ambiguity");
      }
    }
  });

  it("rejects ranges that do not exactly belong to the source", () => {
    const outside = planSourcePatches("abc", [
      { range: patchRange(2, 4), replacement: "x" },
    ]);
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.diagnostics[0].code, "edit.range");

    const wrongCoordinates = planSourcePatches("α", [
      { range: patchRange(0, 1), replacement: "x" },
    ]);
    assert.equal(wrongCoordinates.ok, false);
    if (!wrongCoordinates.ok) {
      assert.equal(wrongCoordinates.diagnostics[0].code, "edit.range");
    }
  });

  it("preserves every byte represented by retained map segments", () => {
    let state = 0x9e3779b9;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };

    for (let fixture = 0; fixture < 256; fixture += 1) {
      const source = Array.from(
        { length: 48 },
        () => String.fromCharCode(97 + (next() % 26)),
      ).join("");
      const firstStart = next() % 12;
      const firstEnd = firstStart + 1 + (next() % 5);
      const secondStart = firstEnd + 1 + (next() % 12);
      const secondEnd = secondStart + 1 + (next() % 5);
      const planned = planSourcePatches(source, [
        {
          range: patchRange(secondStart, secondEnd),
          replacement: `B${fixture}`,
        },
        {
          range: patchRange(firstStart, firstEnd),
          replacement: `A${fixture}`,
        },
      ]);
      assert.equal(planned.ok, true);
      if (!planned.ok) continue;
      const applied = applySourcePatches(planned.value);

      for (const segment of applied.map.segments) {
        if (segment.kind !== "retained") continue;
        assert.equal(
          source.slice(
            segment.original.start.byteOffset,
            segment.original.end.byteOffset,
          ),
          applied.text.slice(
            segment.generated.start.byteOffset,
            segment.generated.end.byteOffset,
          ),
        );
      }
    }
  });
});
