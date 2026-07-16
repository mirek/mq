import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileExpression,
  compileSelector,
  loadSchema,
  MQ_SCHEMA_V1,
  parse,
  render,
  resourceLimits,
  validate,
} from "../src/index.ts";

describe("parser recovery limits", () => {
  it("preserves an over-byte-limit document as one post-BOM opaque range", () => {
    const source = "\uFEFF# A\nbody\n";
    const parsed = parse(source, { limits: { maxBytes: 4 } });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.value.cst.children.map(({ kind }) => kind), [
      "bom",
      "opaque",
    ]);
    assert.equal(parsed.value.preamble[0]?.type, "opaque");
    assert.equal(
      parsed.value.preamble[0]?.type === "opaque" &&
        parsed.value.preamble[0].reason,
      "limit-max-bytes",
    );
    assert.deepEqual(parsed.value.diagnostics.map(({ code }) => code), [
      "markdown.limit",
    ]);
    assert.deepEqual(
      [
        parsed.value.preamble[0]?.range.start.byteOffset,
        parsed.value.preamble[0]?.range.end.byteOffset,
      ],
      [3, Buffer.byteLength(source)],
    );
    assert.equal(render(parsed.value), source);

    const bomOnly = parse("\uFEFF", { limits: { maxBytes: 0 } });
    assert.equal(bomOnly.ok, true);
    if (bomOnly.ok) {
      assert.deepEqual(bomOnly.value.cst.children.map(({ kind }) => kind), [
        "bom",
      ]);
      assert.deepEqual(bomOnly.value.diagnostics.map(({ code }) => code), [
        "markdown.limit",
      ]);
      assert.equal(render(bomOnly.value), "\uFEFF");
    }
  });

  it("keeps the accepted node prefix and recovers the remaining suffix", () => {
    const source = "# A\n# B\n# C\n";
    const parsed = parse(source, { limits: { maxNodes: 2 } });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.value.cst.children.map(({ kind }) => kind), [
      "atx-heading",
      "opaque",
    ]);
    assert.equal(parsed.value.sections[0]?.title, "A");
    assert.deepEqual(
      parsed.value.sections[0]?.body.map(({ type }) => type),
      ["opaque"],
    );
    const opaque = parsed.value.sections[0]?.body[0];
    assert.equal(opaque?.type, "opaque");
    assert.equal(opaque?.type === "opaque" && opaque.reason, "limit-max-nodes");
    assert.deepEqual(
      [opaque?.range.start.byteOffset, opaque?.range.end.byteOffset],
      [Buffer.byteLength("# A\n"), Buffer.byteLength(source)],
    );
    assert.equal(render(parsed.value), source);
  });

  it("recovers only an over-depth top-level block and resumes afterward", () => {
    const source = "> > deep\n\n# After\n";
    const parsed = parse(source, { limits: { maxNestingDepth: 2 } });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.value.cst.children.map(({ kind }) => kind), [
      "opaque",
      "blank-line",
      "atx-heading",
    ]);
    assert.equal(parsed.value.preamble[0]?.type, "opaque");
    assert.equal(parsed.value.sections[0]?.title, "After");
    assert.equal(render(parsed.value), source);
  });

  it("caps recovery diagnostics and marks truncation deterministically", () => {
    const source = [
      "[^one]: first",
      "",
      "[^two]: second",
      "",
      "[^three]: third",
    ].join("\n");
    const parsed = parse(source, { limits: { maxDiagnostics: 2 } });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(parsed.value.diagnostics.map(({ code }) => code), [
      "markdown.opaque-block",
      "markdown.diagnostic-limit",
    ]);
    assert.equal(parsed.value.diagnostics.length, 2);
    assert.equal(render(parsed.value), source);
  });

  it("uses finite default nesting recovery for adversarial containers", () => {
    const source = `${"> ".repeat(512)}deep\n# After\n`;
    const parsed = parse(source);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(
      parsed.value.diagnostics.some(({ code }) => code === "markdown.limit"),
      true,
    );
    assert.equal(render(parsed.value), source);
  });
});

describe("selector compilation limits", () => {
  it("rejects excessive lists, steps, tests, nesting, and source bytes", () => {
    let nested = "heading";
    for (let index = 0; index < 17; index += 1) nested = `:not(${nested})`;

    const selectors = [
      Array.from({ length: 65 }, () => "heading").join(","),
      `heading${" heading".repeat(256)}`,
      `heading${"[level=1]".repeat(257)}`,
      nested,
      "x".repeat(65_537),
    ];

    for (const source of selectors) {
      const compiled = compileSelector(source);
      assert.equal(compiled.ok, false);
      if (!compiled.ok) {
        assert.equal(compiled.diagnostics[0].code, "selector.limit");
        assert.equal(compiled.diagnostics[0].source, "selector");
      }
    }
  });
});

describe("finite production defaults", () => {
  it("publishes deeply immutable positive limits", () => {
    assert.equal(Object.isFrozen(resourceLimits), true);
    for (const group of Object.values(resourceLimits)) {
      assert.equal(Object.isFrozen(group), true);
      for (const value of Object.values(group)) {
        assert.equal(Number.isSafeInteger(value) && value > 0, true);
      }
    }
  });

  it("bounds expression source and stage counts", () => {
    for (const source of [
      "x".repeat(resourceLimits.expression.maxBytes + 1),
      Array.from(
        { length: resourceLimits.expression.maxStages + 1 },
        () => ".",
      ).join(" | "),
    ]) {
      const compiled = compileExpression(source);
      assert.equal(compiled.ok, false);
      if (!compiled.ok) {
        assert.equal(compiled.diagnostics[0].code, "expression.limit");
      }
    }
  });

  it("bounds schema bytes, depth, rules, and loading diagnostics", () => {
    const tooLarge = loadSchema(" ".repeat(resourceLimits.schema.maxBytes + 1));
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) assert.equal(tooLarge.diagnostics[0].code, "schema.limit");

    const nested = `${"[".repeat(resourceLimits.schema.maxDepth + 1)}null${"]".repeat(resourceLimits.schema.maxDepth + 1)}`;
    const tooDeep = loadSchema(nested);
    assert.equal(tooDeep.ok, false);
    if (!tooDeep.ok) assert.equal(tooDeep.diagnostics[0].code, "schema.limit");

    const tooManyRules = loadSchema({
      $schema: MQ_SCHEMA_V1,
      rules: Array.from(
        { length: resourceLimits.schema.maxRules + 1 },
        () => ({ selector: "heading", count: { min: 0 } }),
      ),
    });
    assert.equal(tooManyRules.ok, false);
    if (!tooManyRules.ok) assert.equal(tooManyRules.diagnostics[0].code, "schema.limit");

    const noisy: Record<string, unknown> = {};
    for (let index = 0; index < resourceLimits.schema.maxDiagnostics + 20; index += 1) {
      noisy[`unknown-${index}`] = true;
    }
    const diagnostics = loadSchema(noisy);
    assert.equal(diagnostics.ok, false);
    if (!diagnostics.ok) {
      assert.equal(diagnostics.diagnostics.length, resourceLimits.schema.maxDiagnostics);
      assert.equal(diagnostics.diagnostics.at(-1)?.code, "schema.diagnostic-limit");
    }
  });

  it("caps validation diagnostics", () => {
    const source = Array.from(
      { length: resourceLimits.validation.maxDiagnostics + 20 },
      (_, index) => `# Heading ${index}\n`,
    ).join("");
    const document = parse(source);
    assert.equal(document.ok, true);
    if (!document.ok) return;
    const result = validate(document.value, {
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", text: { enum: [] } }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.diagnostics.length, resourceLimits.validation.maxDiagnostics);
      assert.equal(result.diagnostics.at(-1)?.code, "schema.diagnostic-limit");
    }
  });
});
