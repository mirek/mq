import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileExpression,
  type CompiledExpression,
  type Result,
} from "../src/index.ts";

const compile = (source: string): CompiledExpression => {
  const result: Result<CompiledExpression> = compileExpression(source);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expression did not compile");
  return result.value;
};

describe("expression compilation", () => {
  it("compiles every initial value, projection, and collection stage", () => {
    const expressions = [
      ".",
      'select("section[level=2]")',
      "markdown",
      "text",
      "json",
      "count",
      "first",
      "last",
      "array",
    ];

    for (const source of expressions) {
      const compiled = compile(source);
      assert.equal(compiled.source, source);
      assert.equal(Object.isFrozen(compiled), true);
    }
  });

  it("compiles whitespace-separated pipelines once as reusable values", () => {
    const source =
      '  select("section[title=\\"Café 😀\\"]")\n | text | json | array  ';
    const compiled = compile(source);

    assert.equal(compiled.source, source);
    assert.strictEqual(compiled, compiled);
  });

  it("rejects trailing input and reports its exact expression range", () => {
    const result = compileExpression("markdown unexpected");

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.diagnostics[0], {
      code: "expression.syntax",
      severity: "error",
      message: "Unexpected input after expression stage.",
      source: "expression",
      range: {
        start: { byteOffset: 9, line: 1, column: 10, utf16Column: 10 },
        end: { byteOffset: 19, line: 1, column: 20, utf16Column: 20 },
      },
    });
  });

  it("reports Unicode-aware ranges within multiline expression source", () => {
    const source = 'select("section[title=\\"Café 😀\\"]") |\n 💥';
    const result = compileExpression(source);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0].code, "expression.syntax");
    assert.deepEqual(result.diagnostics[0].range, {
      start: { byteOffset: 43, line: 2, column: 2, utf16Column: 2 },
      end: { byteOffset: 47, line: 2, column: 3, utf16Column: 4 },
    });
  });

  it("maps invalid nested selectors to their expression string range", () => {
    const result = compileExpression('select("section[=2]") | text');

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0].code, "selector.syntax");
    assert.equal(result.diagnostics[0].source, "expression");
    assert.deepEqual(
      [
        result.diagnostics[0].range?.start.byteOffset,
        result.diagnostics[0].range?.end.byteOffset,
      ],
      [7, 20],
    );
  });

  it("returns immutable syntax failures instead of throwing on user input", () => {
    const invalid = [
      "",
      " ",
      "select",
      "select()",
      'select("unterminated)',
      'select("line\nbreak")',
      "markdown()",
      "unknown",
      "| text",
      "text |",
      "text || json",
      "text json",
      "\0",
      "\ud800",
    ];

    for (const source of invalid) {
      let result: Result<CompiledExpression> | undefined;
      assert.doesNotThrow(() => {
        result = compileExpression(source);
      });
      assert.equal(result?.ok, false, source);
      if (result?.ok === false) {
        assert.equal(Object.isFrozen(result), true);
        assert.equal(Object.isFrozen(result.diagnostics), true);
        assert.equal(result.diagnostics[0].source, "expression");
        assert.ok(result.diagnostics[0].range);
      }
    }
  });
});
