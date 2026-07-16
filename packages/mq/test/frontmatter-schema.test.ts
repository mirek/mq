import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeFrontmatter } from "../src/frontmatter.ts";
import { parse } from "../src/parse.ts";
import { render } from "../src/render.ts";
import { loadSchema, MQ_SCHEMA_V1, type MarkdownSchemaInput } from "../src/schema.ts";
import { validateSchema } from "../src/validate.ts";

const frontmatter = (source: string) => {
  const parsed = parse(source, { path: "record.md" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture must parse");
  const node = parsed.value.preamble[0];
  assert.equal(node?.type, "frontmatter");
  if (node?.type !== "frontmatter") throw new Error("fixture needs frontmatter");
  return { document: parsed.value, node };
};

const schema = (input: MarkdownSchemaInput) => {
  const loaded = loadSchema(input);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("fixture schema must load");
  return loaded.value;
};

describe("frontmatter decoding and JSON Schema", () => {
  it("decodes YAML, TOML, and JSON into portable immutable values", () => {
    const cases = [
      ["---\ntitle: Guide\ncount: 2\n---\n", { title: "Guide", count: 2 }],
      ['+++\ntitle = "Guide"\ndate = 1979-05-27\n+++\n', {
        title: "Guide",
        date: "1979-05-27",
      }],
      ['{\n  "title": "Guide",\n  "count": 2\n}\n', { title: "Guide", count: 2 }],
    ] as const;

    for (const [source, expected] of cases) {
      const { node } = frontmatter(source);
      const decoded = decodeFrontmatter(node);
      assert.equal(decoded.ok, true);
      if (!decoded.ok) continue;
      assert.deepEqual(decoded.value, expected);
      assert.equal(Object.isFrozen(decoded.value), true);
    }
  });

  it("applies strict local Draft 2020-12 JSON Schema validation", () => {
    const template = schema({
      $schema: MQ_SCHEMA_V1,
      rules: [],
      frontmatter: {
        type: "object",
        required: ["title", "count"],
        properties: {
          title: { type: "string" },
          count: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    });
    const valid = frontmatter("---\ntitle: Guide\ncount: 2\n---\n").document;
    const invalid = frontmatter('+++\ntitle = "Guide"\ncount = 0\nextra = true\n+++\n').document;

    assert.deepEqual(validateSchema(valid, template), []);
    const diagnostics = validateSchema(invalid, template);
    assert.deepEqual(
      diagnostics.map(({ code }) => code),
      ["schema.frontmatter", "schema.frontmatter"],
    );
    assert.equal(diagnostics.every(({ range }) => range?.start.line === 1), true);
  });

  it("preserves malformed frontmatter source and returns decode diagnostics", () => {
    const sources = [
      "---\nvalue: [\n---\nbody\n",
      "---\nbase: &base { value: 1 }\ncopy: *base\n---\nbody\n",
      "+++\nvalue = [\n+++\nbody\n",
      '{\n  "value": 1,\n  "value": 2\n}\nbody\n',
    ];

    for (const source of sources) {
      const { document, node } = frontmatter(source);
      const decoded = decodeFrontmatter(
        node,
        document.path === undefined ? {} : { path: document.path },
      );
      assert.equal(decoded.ok, false);
      if (!decoded.ok) {
        assert.equal(decoded.diagnostics[0].code, "schema.frontmatter-decode");
        assert.equal(decoded.diagnostics[0].path, "record.md");
        assert.deepEqual(decoded.diagnostics[0].range, node.range);
      }
      assert.equal(render(document), source);
    }
  });

  it("rejects invalid or remotely resolved frontmatter schemas while loading", () => {
    for (const frontmatterSchema of [
      { type: "not-a-json-schema-type" },
      { $ref: "https://example.com/remote-schema.json" },
      { $async: true, type: "object" },
    ]) {
      const loaded = loadSchema({
        $schema: MQ_SCHEMA_V1,
        rules: [],
        frontmatter: frontmatterSchema,
      });
      assert.equal(loaded.ok, false);
      if (!loaded.ok) {
        assert.equal(loaded.diagnostics[0].code, "schema.frontmatter-schema");
      }
    }
  });
});
