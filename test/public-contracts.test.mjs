import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const workspace = resolve(import.meta.dirname, "..");
const publicTypeExports = [
  "BlankLine",
  "Block",
  "Blockquote",
  "BreakInline",
  "CodeBlock",
  "CompiledExpression",
  "CompiledSelector",
  "ConcreteDocument",
  "ConcreteNode",
  "ConcreteNodeKind",
  "Definition",
  "Diagnostic",
  "DiagnosticNote",
  "DiagnosticSeverity",
  "DiagnosticSource",
  "Document",
  "EditOperation",
  "Emphasis",
  "Failure",
  "FlowNode",
  "Frontmatter",
  "FrontmatterFormat",
  "Heading",
  "HeadingLevel",
  "HtmlNode",
  "Image",
  "Inline",
  "InlineCode",
  "InlineContainer",
  "JsonObject",
  "JsonPrimitive",
  "JsonValue",
  "Link",
  "ListBlock",
  "ListItem",
  "MarkdownFragment",
  "MarkdownNode",
  "MarkdownSchema",
  "MarkdownSchemaInput",
  "MarkdownSchemaOptions",
  "MarkdownSchemaRule",
  "NewlineOccurrence",
  "NewlineStyle",
  "NonEmptyReadonlyArray",
  "OpaqueBlock",
  "OpaqueInline",
  "Paragraph",
  "ParseLimits",
  "ParseOptions",
  "PatchedSource",
  "QueryJsonObject",
  "QueryJsonPrimitive",
  "QueryJsonValue",
  "QueryValue",
  "Result",
  "SchemaAttributeConstraints",
  "SchemaAttributeRange",
  "SchemaChildrenConstraint",
  "SchemaCountConstraint",
  "SchemaExtensions",
  "SchemaLoadOptions",
  "SchemaMarkdownConstraint",
  "SchemaScalar",
  "SchemaTextConstraint",
  "Section",
  "SelectOptions",
  "SourceMap",
  "SourceMapSegment",
  "SourcePatch",
  "SourcePatchPlan",
  "SourcePosition",
  "SourceRange",
  "SourceText",
  "Strikethrough",
  "Strong",
  "Success",
  "Table",
  "TableAlignment",
  "TableCell",
  "TableRow",
  "TextInline",
  "ThematicBreak",
];

describe("public package contracts", () => {
  it("pins every exported TypeScript type for deliberate review", () => {
    const declarations = readFileSync(
      resolve(workspace, "packages/mq/dist/index.d.ts"),
      "utf8",
    );
    const actual = Array.from(declarations.matchAll(/export type \{([^}]*)\}/gu))
      .flatMap((match) => match[1].split(","))
      .map((name) => name.trim())
      .filter(Boolean)
      .toSorted();
    assert.deepEqual(actual, publicTypeExports);
  });
});
