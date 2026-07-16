import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validate } from "../src/index.ts";
import { parse } from "../src/parse.ts";
import { loadSchema, MQ_SCHEMA_V1, type MarkdownSchemaInput } from "../src/schema.ts";
import { validateSchema } from "../src/validate.ts";

const document = (source: string) => {
  const parsed = parse(source, { path: "record.md" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture must parse");
  return parsed.value;
};

const schema = (input: MarkdownSchemaInput) => {
  const loaded = loadSchema(input);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("fixture schema must load");
  return loaded.value;
};

describe("schema rule evaluation", () => {
  it("exposes equivalent Result behavior for JSON and typed schemas", () => {
    const markdown = document("# Wrong\n");
    const input: MarkdownSchemaInput = {
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", text: { enum: ["Right"] } }],
    };
    const typed = validate(markdown, input);
    const json = validate(markdown, JSON.stringify(input));
    assert.equal(typed.ok, false);
    assert.equal(json.ok, false);
    if (!typed.ok && !json.ok) {
      assert.deepEqual(
        json.diagnostics.map(({ code, message }) => ({ code, message })),
        typed.diagnostics.map(({ code, message }) => ({ code, message })),
      );
    }

    const valid = validate(markdown, {
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", text: { enum: ["Wrong"] } }],
    });
    assert.equal(valid.ok, true);
    if (valid.ok) assert.equal(valid.value, markdown);
  });

  it("accepts a template exercising every rule family from typed and JSON schemas", () => {
    const markdown = document(
      "# Record\nIntro.\n\n## Status\nAccepted\n\n## Items\n- Alpha\n- Beta\n",
    );
    const input: MarkdownSchemaInput = {
      $schema: MQ_SCHEMA_V1,
      options: { headingRanks: "contiguous" },
      rules: [
        { selector: "document", count: { exact: 1 } },
        {
          selector: "heading",
          text: { minLength: 5, maxLength: 6, pattern: "^[A-Z]" },
          markdown: { pattern: "^#{1,2} " },
          attributes: {
            required: ["level", "style"],
            equals: { style: "atx" },
            ranges: { level: { min: 1, max: 2 } },
          },
          unique: "slug",
        },
        {
          selector: "section[title='Status'] > paragraph",
          text: { enum: ["Accepted"] },
        },
        {
          selector: "section[title='Status']",
          children: {
            allowed: "heading, paragraph, blank-line",
            required: ["heading", "paragraph"],
            order: ["heading", "paragraph"],
          },
        },
      ],
    };

    const typed = schema(input);
    const fromJson = loadSchema(JSON.stringify(input));
    assert.equal(fromJson.ok, true);
    if (!fromJson.ok) return;
    assert.deepEqual(validateSchema(markdown, typed), []);
    assert.deepEqual(validateSchema(markdown, fromJson.value), []);
  });

  it("reports cardinality, content, attributes, children, ranks, and uniqueness", () => {
    const markdown = document("# Same\nParagraph.\n\n### Same\n> nested\n");
    const loaded = schema({
      $schema: MQ_SCHEMA_V1,
      options: { headingRanks: "contiguous" },
      rules: [
        { selector: "heading", count: { exact: 1 } },
        {
          selector: "heading",
          text: { minLength: 8, pattern: "^Allowed$", enum: ["Allowed"] },
          markdown: { pattern: "^## " },
          attributes: {
            required: ["checked"],
            equals: { style: "setext" },
            ranges: { level: { min: 4, max: 6 } },
          },
          unique: "slug",
          message: "Template rule.",
        },
        { selector: "heading", text: { maxLength: 3 } },
        {
          selector: "section[level=1]",
          children: {
            allowed: "heading, paragraph",
            required: ["heading", "list"],
            order: ["paragraph", "heading"],
          },
        },
      ],
    });

    const diagnostics = validateSchema(markdown, loaded);
    const codes = new Set(diagnostics.map(({ code }) => code));
    assert.deepEqual(
      [...codes].toSorted(),
      [
        "schema.attribute-equals",
        "schema.attribute-range",
        "schema.attribute-required",
        "schema.child-allowed",
        "schema.child-order",
        "schema.child-required",
        "schema.count",
        "schema.heading-ranks",
        "schema.markdown-pattern",
        "schema.text-enum",
        "schema.text-max-length",
        "schema.text-min-length",
        "schema.text-pattern",
        "schema.unique",
      ],
    );
    assert.equal(diagnostics.every(Object.isFrozen), true);
    assert.equal(diagnostics.some(({ message }) => message.endsWith("Template rule.")), true);
    assert.equal(diagnostics.every(({ path }) => path === "record.md"), true);
  });

  it("sorts diagnostics by source position and then rule order", () => {
    const markdown = document("# First\n## Second\n");
    const loaded = schema({
      $schema: MQ_SCHEMA_V1,
      rules: [
        { selector: "heading", markdown: { pattern: "never" } },
        { selector: "heading", text: { enum: ["never"] } },
      ],
    });

    const diagnostics = validateSchema(markdown, loaded);
    assert.deepEqual(
      diagnostics.map(({ code, range }) => [code, range?.start.line]),
      [
        ["schema.markdown-pattern", 1],
        ["schema.text-enum", 1],
        ["schema.markdown-pattern", 2],
        ["schema.text-enum", 2],
      ],
    );
  });
});
