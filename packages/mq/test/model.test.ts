import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  failure,
  sourcePosition,
  sourceRange,
  success,
  type Diagnostic,
  type Document,
} from "../src/index.ts";

describe("foundational public model", () => {
  it("constructs discriminated results with immutable diagnostics", () => {
    const warning: Diagnostic = {
      code: "markdown.recovered",
      severity: "warning",
      message: "Recovered an opaque block.",
      source: "markdown",
    };

    const result = success("value", [warning]);

    assert.deepEqual(result, {
      ok: true,
      value: "value",
      diagnostics: [warning],
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.diagnostics), true);
    assert.deepEqual(failure(warning), {
      ok: false,
      diagnostics: [warning],
    });
  });

  it("constructs half-open source ranges from editor-friendly positions", () => {
    const start = sourcePosition(4, 2, 1, 1);
    const end = sourcePosition(9, 2, 5, 6);

    assert.deepEqual(sourceRange(start, end), { start, end });
    assert.throws(
      () => sourceRange(end, start),
      /range end must not precede its start/,
    );
  });

  it("exposes the document shape through the package boundary", () => {
    const start = sourcePosition(0, 1, 1, 1);
    const range = sourceRange(start, start);
    const document = {
      type: "document",
      source: {
        text: "",
        byteLength: 0,
        dominantNewline: undefined,
        mixedNewlines: [],
        hasFinalNewline: false,
      },
      range,
      diagnostics: [],
      cst: { kind: "document", range, children: [] },
      preamble: [],
      children: [],
      sections: [],
    } satisfies Document;

    assert.equal(document.type, "document");
  });
});
