import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse } from "../src/parse.ts";
import { loadSchema, MQ_SCHEMA_V1 } from "../src/schema.ts";
import { validateSchema } from "../src/validate.ts";

describe("validation diagnostic representation", () => {
  it("snapshots overlapping rules across documents with schema locations", () => {
    const schemaSource = [
      "{",
      `  "$schema": ${JSON.stringify(MQ_SCHEMA_V1)},`,
      '  "rules": [',
      '    {"selector":"heading","text":{"enum":["Allowed"]},"message":"Use the template title."},',
      '    {"selector":"heading","attributes":{"equals":{"level":2}}}',
      "  ]",
      "}",
    ].join("\n");
    const loaded = loadSchema(schemaSource, { path: "template.mq.json" });
    const first = parse("# Wrong\n", { path: "first.md" });
    const second = parse("## Wrong\n", { path: "second.md" });
    assert.equal(loaded.ok, true);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!loaded.ok || !first.ok || !second.ok) return;

    const diagnostics = [
      ...validateSchema(first.value, loaded.value),
      ...validateSchema(second.value, loaded.value),
    ];
    const snapshot = diagnostics.map(({ code, message, path, range, notes }) => ({
      code,
      message,
      path,
      line: range?.start.line,
      notes: notes?.map((note) => ({
        message: note.message,
        path: note.path,
        line: note.range?.start.line,
      })),
    }));

    assert.equal(
      JSON.stringify(snapshot, null, 2),
      `[
  {
    "code": "schema.text-enum",
    "message": "Plain text \\"Wrong\\" is not one of [\\"Allowed\\"]. Use the template title.",
    "path": "first.md",
    "line": 1,
    "notes": [
      {
        "message": "Schema rule 1 is defined here.",
        "path": "template.mq.json",
        "line": 4
      }
    ]
  },
  {
    "code": "schema.attribute-equals",
    "message": "Attribute \\"level\\" is 1; expected 2.",
    "path": "first.md",
    "line": 1,
    "notes": [
      {
        "message": "Schema rule 2 is defined here.",
        "path": "template.mq.json",
        "line": 5
      }
    ]
  },
  {
    "code": "schema.text-enum",
    "message": "Plain text \\"Wrong\\" is not one of [\\"Allowed\\"]. Use the template title.",
    "path": "second.md",
    "line": 1,
    "notes": [
      {
        "message": "Schema rule 1 is defined here.",
        "path": "template.mq.json",
        "line": 4
      }
    ]
  }
]`,
    );
  });
});
