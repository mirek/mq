import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadSchema,
  MQ_SCHEMA_V1,
  schemaMetaSchemaV1,
  type MarkdownSchemaInput,
} from "../src/index.ts";

describe("strict schema loading", () => {
  it("loads the complete typed v1 shape as deeply immutable data", () => {
    const input: MarkdownSchemaInput = {
      $schema: MQ_SCHEMA_V1,
      name: "Document template",
      description: "Exercises every v1 loader shape.",
      rules: [
        {
          selector: "document > section[level=1]",
          count: { min: 1, max: 3 },
          text: {
            minLength: 1,
            maxLength: 80,
            pattern: "^[A-Z]",
            enum: ["One", "Two"],
          },
          markdown: { pattern: "^#" },
          attributes: {
            required: ["level", "title"],
            equals: { level: 1, style: "atx" },
            ranges: { level: { min: 1, max: 3 } },
          },
          children: {
            allowed: "heading, paragraph",
            required: ["heading"],
            order: ["heading", "paragraph"],
          },
          unique: "slug",
          message: "Use one top-level section.",
          "x-rule-note": { owner: "docs" },
        },
      ],
      options: {
        headingRanks: "contiguous",
        extensions: "allow",
      },
      frontmatter: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
      "x-owner": "docs",
    };

    const loaded = loadSchema(input);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.value, input);
    assert.equal(Object.isFrozen(loaded.value), true);
    assert.equal(Object.isFrozen(loaded.value.rules), true);
    assert.equal(Object.isFrozen(loaded.value.rules[0]!.attributes!.equals), true);
    assert.equal(Object.isFrozen(loaded.value.frontmatter), true);
  });

  it("loads equivalent JSON source and exposes the versioned meta-schema", () => {
    const source = JSON.stringify({
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", count: { exact: 1 } }],
    });
    const loaded = loadSchema(source, { path: "template.mq.json" });

    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.value.rules[0]!.selector, "heading");
    assert.equal(schemaMetaSchemaV1.$id, MQ_SCHEMA_V1);
    assert.equal(schemaMetaSchemaV1.additionalProperties, false);
    assert.equal(Object.isFrozen(schemaMetaSchemaV1), true);
  });

  it("rejects unsupported versions at the exact JSON value", () => {
    const loaded = loadSchema('{"$schema":"v2","rules":[]}', {
      path: "future.json",
    });

    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.equal(loaded.diagnostics[0].code, "schema.version");
    assert.equal(loaded.diagnostics[0].path, "future.json");
    assert.deepEqual(loaded.diagnostics[0].range, {
      start: { byteOffset: 11, line: 1, column: 12, utf16Column: 12 },
      end: { byteOffset: 15, line: 1, column: 16, utf16Column: 16 },
    });
  });

  it("rejects unknown keys unless x- extensions are explicitly enabled", () => {
    const rejected = loadSchema({
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", count: { exact: 1 }, typo: true }],
      "x-owner": "docs",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.deepEqual(
        rejected.diagnostics.map(({ code }) => code),
        ["schema.unknown-key", "schema.unknown-key"],
      );
    }

    const accepted = loadSchema({
      $schema: MQ_SCHEMA_V1,
      rules: [{ selector: "heading", count: { exact: 1 }, "x-note": true }],
      options: { extensions: "allow" },
      "x-owner": "docs",
    });
    assert.equal(accepted.ok, true);
  });

  it("rejects malformed constraints and invalid selectors deterministically", () => {
    const loaded = loadSchema({
      $schema: MQ_SCHEMA_V1,
      rules: [
        { selector: "heading[=]", count: { exact: 1, min: 1 } },
        { selector: "paragraph", text: {} },
        { selector: "heading", attributes: { ranges: { level: { min: 3, max: 1 } } } },
        { selector: "section", children: { required: ["wat[=]"] } },
      ],
    });

    assert.equal(loaded.ok, false);
    if (loaded.ok) return;
    assert.deepEqual(
      loaded.diagnostics.map(({ code }) => code),
      [
        "schema.selector",
        "schema.constraint",
        "schema.constraint",
        "schema.constraint",
        "schema.selector",
      ],
    );
  });

  it("rejects malformed and duplicate-key JSON without silently dropping input", () => {
    const duplicate = loadSchema(
      `{
  "$schema": "${MQ_SCHEMA_V1}",
  "rules": [],
  "rules": []
}`,
    );
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.equal(duplicate.diagnostics[0].code, "schema.json-duplicate-key");
      assert.equal(duplicate.diagnostics[0].range?.start.line, 4);
    }

    const malformed = loadSchema('{"$schema":');
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.diagnostics[0].code, "schema.json-syntax");
    }

    const nonJsonWhitespace = loadSchema(
      `{\u00a0"$schema":"${MQ_SCHEMA_V1}","rules":[]}`,
    );
    assert.equal(nonJsonWhitespace.ok, false);
    if (!nonJsonWhitespace.ok) {
      assert.equal(nonJsonWhitespace.diagnostics[0].code, "schema.json-syntax");
    }
  });

  it("rejects non-portable typed input without invoking accessors", () => {
    let accessed = false;
    const accessor = {
      $schema: MQ_SCHEMA_V1,
      rules: [],
    } as Record<string, unknown>;
    Object.defineProperty(accessor, "danger", {
      enumerable: true,
      get: () => {
        accessed = true;
        return true;
      },
    });

    const loaded = loadSchema(accessor);
    assert.equal(loaded.ok, false);
    assert.equal(accessed, false);
    if (!loaded.ok) {
      assert.equal(loaded.diagnostics[0].code, "schema.type");
      assert.equal(loaded.diagnostics[0].message.startsWith("At /danger:"), true);
    }

    const cyclic: Record<string, unknown> = {
      $schema: MQ_SCHEMA_V1,
      rules: [],
    };
    cyclic.self = cyclic;
    assert.equal(loadSchema(cyclic).ok, false);
  });
});
