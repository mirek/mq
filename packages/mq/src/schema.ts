import { RE2JS } from "re2js";

import type { Diagnostic } from "./diagnostic.ts";
import { jsonSchemaCompileError } from "./json-schema.ts";
import { compileSelector } from "./selector.ts";
import { failure, success, type Result } from "./result.ts";
import { sourcePosition, sourceRange, type SourceRange } from "./source.ts";

export const MQ_SCHEMA_V1 = "https://prelude.dev/mq/schema/v1" as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type SchemaScalar = boolean | number | string;

export interface SchemaExtensions {
  readonly [key: `x-${string}`]: JsonValue;
}

export interface SchemaCountConstraint extends SchemaExtensions {
  readonly exact?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface SchemaTextConstraint extends SchemaExtensions {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
}

export interface SchemaMarkdownConstraint extends SchemaExtensions {
  readonly pattern: string;
}

export interface SchemaAttributeRange extends SchemaExtensions {
  readonly min?: number;
  readonly max?: number;
}

export interface SchemaAttributeConstraints extends SchemaExtensions {
  readonly required?: readonly string[];
  readonly equals?: Readonly<Record<string, SchemaScalar>>;
  readonly ranges?: Readonly<Record<string, SchemaAttributeRange>>;
}

export interface SchemaChildrenConstraint extends SchemaExtensions {
  readonly allowed?: string;
  readonly required?: readonly string[];
  readonly order?: readonly string[];
}

export interface MarkdownSchemaRule extends SchemaExtensions {
  readonly selector: string;
  readonly count?: SchemaCountConstraint;
  readonly text?: SchemaTextConstraint;
  readonly markdown?: SchemaMarkdownConstraint;
  readonly attributes?: SchemaAttributeConstraints;
  readonly children?: SchemaChildrenConstraint;
  readonly unique?: string;
  readonly message?: string;
}

export interface MarkdownSchemaOptions extends SchemaExtensions {
  readonly headingRanks?: "contiguous";
  readonly extensions?: "allow";
}

export interface MarkdownSchemaInput extends SchemaExtensions {
  readonly $schema: typeof MQ_SCHEMA_V1;
  readonly name?: string;
  readonly description?: string;
  readonly rules: readonly MarkdownSchemaRule[];
  readonly options?: MarkdownSchemaOptions;
  readonly frontmatter?: JsonObject;
}

export type MarkdownSchema = MarkdownSchemaInput;

export interface SchemaLoadOptions {
  readonly path?: string;
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const schemaMetaSchemaV1 = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: MQ_SCHEMA_V1,
  type: "object",
  required: ["$schema", "rules"],
  additionalProperties: false,
  properties: {
    $schema: { const: MQ_SCHEMA_V1 },
    name: { type: "string" },
    description: { type: "string" },
    rules: {
      type: "array",
      items: { $ref: "#/$defs/rule" },
    },
    options: { $ref: "#/$defs/options" },
    frontmatter: { type: "object" },
  },
  $defs: {
    nonNegativeInteger: { type: "integer", minimum: 0 },
    selectorList: { type: "array", items: { type: "string" } },
    count: {
      type: "object",
      additionalProperties: false,
      properties: {
        exact: { $ref: "#/$defs/nonNegativeInteger" },
        min: { $ref: "#/$defs/nonNegativeInteger" },
        max: { $ref: "#/$defs/nonNegativeInteger" },
      },
      minProperties: 1,
    },
    text: {
      type: "object",
      additionalProperties: false,
      properties: {
        minLength: { $ref: "#/$defs/nonNegativeInteger" },
        maxLength: { $ref: "#/$defs/nonNegativeInteger" },
        pattern: { type: "string" },
        enum: { type: "array", items: { type: "string" } },
      },
      minProperties: 1,
    },
    markdown: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: { pattern: { type: "string" } },
    },
    attributeRange: {
      type: "object",
      additionalProperties: false,
      properties: { min: { type: "number" }, max: { type: "number" } },
      minProperties: 1,
    },
    attributes: {
      type: "object",
      additionalProperties: false,
      properties: {
        required: { type: "array", items: { type: "string" } },
        equals: {
          type: "object",
          additionalProperties: { type: ["boolean", "number", "string"] },
        },
        ranges: {
          type: "object",
          additionalProperties: { $ref: "#/$defs/attributeRange" },
        },
      },
      minProperties: 1,
    },
    children: {
      type: "object",
      additionalProperties: false,
      properties: {
        allowed: { type: "string" },
        required: { $ref: "#/$defs/selectorList" },
        order: { $ref: "#/$defs/selectorList" },
      },
      minProperties: 1,
    },
    rule: {
      type: "object",
      additionalProperties: false,
      required: ["selector"],
      properties: {
        selector: { type: "string" },
        count: { $ref: "#/$defs/count" },
        text: { $ref: "#/$defs/text" },
        markdown: { $ref: "#/$defs/markdown" },
        attributes: { $ref: "#/$defs/attributes" },
        children: { $ref: "#/$defs/children" },
        unique: { type: "string" },
        message: { type: "string" },
      },
      minProperties: 2,
    },
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        headingRanks: { const: "contiguous" },
        extensions: { const: "allow" },
      },
    },
  },
} as const);

interface JsonNode {
  readonly start: number;
  readonly end: number;
  readonly properties?: ReadonlyMap<string, JsonNode>;
  readonly keys?: ReadonlyMap<string, JsonNode>;
  readonly items?: readonly JsonNode[];
}

interface ParsedJson {
  readonly value: JsonValue;
  readonly node: JsonNode;
}

class JsonSourceError extends Error {
  readonly code: "schema.json-duplicate-key" | "schema.json-syntax";
  readonly start: number;
  readonly end: number;

  constructor(
    code: "schema.json-duplicate-key" | "schema.json-syntax",
    message: string,
    start: number,
    end: number,
  ) {
    super(message);
    this.code = code;
    this.start = start;
    this.end = end;
  }
}

class JsonReader {
  private offset = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): ParsedJson {
    this.whitespace();
    const parsed = this.value();
    this.whitespace();
    if (this.offset !== this.source.length) this.syntax("Unexpected JSON input.");
    return parsed;
  }

  private whitespace(): void {
    while (
      this.source[this.offset] === " " ||
      this.source[this.offset] === "\t" ||
      this.source[this.offset] === "\n" ||
      this.source[this.offset] === "\r"
    ) {
      this.offset += 1;
    }
  }

  private value(): ParsedJson {
    this.whitespace();
    const character = this.source[this.offset];
    if (character === "{") return this.object();
    if (character === "[") return this.array();
    if (character === '"') {
      const string = this.string();
      return { value: string.value, node: string.node };
    }
    if (character === "t") return this.literal("true", true);
    if (character === "f") return this.literal("false", false);
    if (character === "n") return this.literal("null", null);
    return this.number();
  }

  private object(): ParsedJson {
    const start = this.offset++;
    const value: Record<string, JsonValue> = {};
    const properties = new Map<string, JsonNode>();
    const keys = new Map<string, JsonNode>();
    this.whitespace();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return { value, node: { start, end: this.offset, properties, keys } };
    }
    while (true) {
      if (this.source[this.offset] !== '"') this.syntax("Expected an object key.");
      const key = this.string();
      if (keys.has(key.value)) {
        throw new JsonSourceError(
          "schema.json-duplicate-key",
          `Duplicate JSON key ${JSON.stringify(key.value)}.`,
          key.node.start,
          key.node.end,
        );
      }
      keys.set(key.value, key.node);
      this.whitespace();
      if (this.source[this.offset] !== ":") this.syntax("Expected ':' after an object key.");
      this.offset += 1;
      const child = this.value();
      Object.defineProperty(value, key.value, {
        configurable: true,
        enumerable: true,
        value: child.value,
        writable: true,
      });
      properties.set(key.value, child.node);
      this.whitespace();
      const separator = this.source[this.offset++];
      if (separator === "}") break;
      if (separator !== ",") this.syntax("Expected ',' or '}' in an object.", this.offset - 1);
      this.whitespace();
    }
    return { value, node: { start, end: this.offset, properties, keys } };
  }

  private array(): ParsedJson {
    const start = this.offset++;
    const value: JsonValue[] = [];
    const items: JsonNode[] = [];
    this.whitespace();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return { value, node: { start, end: this.offset, items } };
    }
    while (true) {
      const child = this.value();
      value.push(child.value);
      items.push(child.node);
      this.whitespace();
      const separator = this.source[this.offset++];
      if (separator === "]") break;
      if (separator !== ",") this.syntax("Expected ',' or ']' in an array.", this.offset - 1);
      this.whitespace();
    }
    return { value, node: { start, end: this.offset, items } };
  }

  private string(): { readonly value: string; readonly node: JsonNode } {
    const start = this.offset++;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset]!;
      if (character === '"') {
        this.offset += 1;
        const token = this.source.slice(start, this.offset);
        return {
          value: JSON.parse(token) as string,
          node: { start, end: this.offset },
        };
      }
      if (character.charCodeAt(0) < 0x20) this.syntax("Unescaped control character in a string.");
      if (character === "\\") {
        const escape = this.source[this.offset + 1];
        if (escape === "u") {
          if (!/^[0-9A-Fa-f]{4}$/u.test(this.source.slice(this.offset + 2, this.offset + 6))) {
            this.syntax("Invalid Unicode escape in a string.");
          }
          this.offset += 6;
          continue;
        }
        if (escape === undefined || !/^["\\/bfnrt]$/u.test(escape)) {
          this.syntax("Invalid escape in a string.");
        }
        this.offset += 2;
        continue;
      }
      this.offset += 1;
    }
    this.syntax("Unterminated JSON string.", start);
  }

  private literal(token: string, value: JsonPrimitive): ParsedJson {
    const start = this.offset;
    if (this.source.slice(start, start + token.length) !== token) {
      this.syntax("Invalid JSON value.");
    }
    this.offset += token.length;
    return { value, node: { start, end: this.offset } };
  }

  private number(): ParsedJson {
    const start = this.offset;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(start),
    );
    if (match === null || match[0].length === 0) this.syntax("Expected a JSON value.");
    this.offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.syntax("JSON number is outside the finite range.", start);
    return { value, node: { start, end: this.offset } };
  }

  private syntax(message: string, at = this.offset): never {
    const end = Math.min(at + 1, this.source.length);
    throw new JsonSourceError("schema.json-syntax", message, at, end);
  }
}

const positionAt = (source: string, end: number) => {
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;
  for (let offset = 0; offset < end; ) {
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      offset += 2;
      byteOffset += 2;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }
    if (source[offset] === "\r" || source[offset] === "\n") {
      offset += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }
    const codePoint = source.codePointAt(offset)!;
    const width = codePoint > 0xffff ? 2 : 1;
    offset += width;
    byteOffset += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    column += 1;
    utf16Column += width;
  }
  return sourcePosition(byteOffset, line, column, utf16Column);
};

const jsonRange = (source: string, node: JsonNode): SourceRange =>
  sourceRange(positionAt(source, node.start), positionAt(source, node.end));

const isObject = (value: JsonValue): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const pointer = (parts: readonly (number | string)[]): string =>
  parts.length === 0
    ? "/"
    : `/${parts
        .map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1"))
        .join("/")}`;

class SchemaValidator {
  readonly diagnostics: Diagnostic[] = [];
  private readonly extensions: boolean;
  private readonly root: JsonValue;
  private readonly rootNode: JsonNode | undefined;
  private readonly source: string | undefined;
  private readonly options: SchemaLoadOptions;

  constructor(
    root: JsonValue,
    rootNode: JsonNode | undefined,
    source: string | undefined,
    options: SchemaLoadOptions,
  ) {
    this.root = root;
    this.rootNode = rootNode;
    this.source = source;
    this.options = options;
    const rootOptions = isObject(root) ? root.options : undefined;
    this.extensions =
      rootOptions !== undefined &&
      isObject(rootOptions) &&
      rootOptions.extensions === "allow";
  }

  validate(): this {
    if (!isObject(this.root)) {
      this.add("schema.type", "The schema must be an object.", [], this.rootNode);
      return this;
    }
    this.unknown(this.root, this.rootNode, [], [
      "$schema",
      "name",
      "description",
      "rules",
      "options",
      "frontmatter",
    ]);
    const version = this.property(this.root, this.rootNode, "$schema");
    if (version.value === undefined) {
      this.add("schema.required", "Required key \"$schema\" is missing.", [], this.rootNode);
    } else if (version.value !== MQ_SCHEMA_V1) {
      this.add(
        "schema.version",
        `Unsupported schema version ${JSON.stringify(version.value)}.`,
        ["$schema"],
        version.node,
      );
    }
    this.optionalString(this.root, this.rootNode, "name", []);
    this.optionalString(this.root, this.rootNode, "description", []);
    this.validateOptions();
    const frontmatter = this.property(this.root, this.rootNode, "frontmatter");
    if (frontmatter.value !== undefined && !isObject(frontmatter.value)) {
      this.add("schema.type", "Frontmatter JSON Schema must be an object.", ["frontmatter"], frontmatter.node);
    } else if (frontmatter.value !== undefined) {
      const message = jsonSchemaCompileError(frontmatter.value);
      if (message !== undefined) {
        this.add(
          "schema.frontmatter-schema",
          `Invalid or non-local frontmatter JSON Schema: ${message}`,
          ["frontmatter"],
          frontmatter.node,
        );
      }
    }
    const rules = this.property(this.root, this.rootNode, "rules");
    if (rules.value === undefined) {
      this.add("schema.required", "Required key \"rules\" is missing.", [], this.rootNode);
    } else if (!Array.isArray(rules.value)) {
      this.add("schema.type", "Rules must be an array.", ["rules"], rules.node);
    } else {
      rules.value.forEach((rule, index) => this.validateRule(rule, rules.node?.items?.[index], index));
    }
    return this;
  }

  private validateOptions(): void {
    if (!isObject(this.root)) return;
    const property = this.property(this.root, this.rootNode, "options");
    if (property.value === undefined) return;
    if (!isObject(property.value)) {
      this.add("schema.type", "Options must be an object.", ["options"], property.node);
      return;
    }
    this.unknown(property.value, property.node, ["options"], ["headingRanks", "extensions"]);
    const headingRanks = this.property(property.value, property.node, "headingRanks");
    if (headingRanks.value !== undefined && headingRanks.value !== "contiguous") {
      this.add("schema.constraint", 'headingRanks must be "contiguous".', ["options", "headingRanks"], headingRanks.node);
    }
    const extensions = this.property(property.value, property.node, "extensions");
    if (extensions.value !== undefined && extensions.value !== "allow") {
      this.add("schema.constraint", 'extensions must be "allow".', ["options", "extensions"], extensions.node);
    }
  }

  private validateRule(value: JsonValue, node: JsonNode | undefined, index: number): void {
    const at = ["rules", index] as const;
    if (!isObject(value)) {
      this.add("schema.type", "A rule must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, [
      "selector",
      "count",
      "text",
      "markdown",
      "attributes",
      "children",
      "unique",
      "message",
    ]);
    const selector = this.property(value, node, "selector");
    if (selector.value === undefined) {
      this.add("schema.required", "A rule requires a selector.", at, node);
    } else {
      this.selector(selector.value, selector.node, [...at, "selector"]);
    }
    let constraints = 0;
    const count = this.property(value, node, "count");
    if (count.value !== undefined) {
      constraints += 1;
      this.validateCount(count.value, count.node, [...at, "count"]);
    }
    const text = this.property(value, node, "text");
    if (text.value !== undefined) {
      constraints += 1;
      this.validateText(text.value, text.node, [...at, "text"]);
    }
    const markdown = this.property(value, node, "markdown");
    if (markdown.value !== undefined) {
      constraints += 1;
      this.validateMarkdown(markdown.value, markdown.node, [...at, "markdown"]);
    }
    const attributes = this.property(value, node, "attributes");
    if (attributes.value !== undefined) {
      constraints += 1;
      this.validateAttributes(attributes.value, attributes.node, [...at, "attributes"]);
    }
    const children = this.property(value, node, "children");
    if (children.value !== undefined) {
      constraints += 1;
      this.validateChildren(children.value, children.node, [...at, "children"]);
    }
    const unique = this.property(value, node, "unique");
    if (unique.value !== undefined) {
      constraints += 1;
      if (this.nonEmptyString(unique.value, unique.node, [...at, "unique"], "unique")) {
        this.attributeName(unique.value, unique.node, [...at, "unique"]);
      }
    }
    this.optionalString(value, node, "message", at);
    if (constraints === 0) {
      this.add("schema.constraint", "A rule requires at least one validation constraint.", at, node);
    }
  }

  private validateCount(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value)) {
      this.add("schema.type", "count must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, ["exact", "min", "max"]);
    const present = ["exact", "min", "max"].filter((key) => value[key] !== undefined);
    if (present.length === 0) this.add("schema.constraint", "count must contain exact, min, or max.", at, node);
    for (const key of present) this.nonNegativeInteger(value[key]!, this.property(value, node, key).node, [...at, key]);
    if (value.exact !== undefined && (value.min !== undefined || value.max !== undefined)) {
      this.add("schema.constraint", "count.exact cannot be combined with min or max.", at, node);
    } else if (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max) {
      this.add("schema.constraint", "count.min must not exceed count.max.", at, node);
    }
  }

  private validateText(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value)) {
      this.add("schema.type", "text must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, ["minLength", "maxLength", "pattern", "enum"]);
    const present = ["minLength", "maxLength", "pattern", "enum"].filter((key) => value[key] !== undefined);
    if (present.length === 0) this.add("schema.constraint", "text must contain a constraint.", at, node);
    for (const key of ["minLength", "maxLength"] as const) {
      if (value[key] !== undefined) this.nonNegativeInteger(value[key], this.property(value, node, key).node, [...at, key]);
    }
    if (typeof value.minLength === "number" && typeof value.maxLength === "number" && value.minLength > value.maxLength) {
      this.add("schema.constraint", "text.minLength must not exceed text.maxLength.", at, node);
    }
    if (value.pattern !== undefined) this.pattern(value.pattern, this.property(value, node, "pattern").node, [...at, "pattern"]);
    if (value.enum !== undefined) this.stringArray(value.enum, this.property(value, node, "enum").node, [...at, "enum"]);
  }

  private validateMarkdown(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value)) {
      this.add("schema.type", "markdown must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, ["pattern"]);
    const pattern = this.property(value, node, "pattern");
    if (pattern.value === undefined) this.add("schema.required", "markdown requires pattern.", at, node);
    else this.pattern(pattern.value, pattern.node, [...at, "pattern"]);
  }

  private validateAttributes(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value)) {
      this.add("schema.type", "attributes must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, ["required", "equals", "ranges"]);
    const present = ["required", "equals", "ranges"].filter((key) => value[key] !== undefined);
    if (present.length === 0) this.add("schema.constraint", "attributes must contain a constraint.", at, node);
    const required = this.property(value, node, "required");
    if (required.value !== undefined) this.attributeNames(required.value, required.node, [...at, "required"]);
    const equals = this.property(value, node, "equals");
    if (equals.value !== undefined) {
      if (!isObject(equals.value) || Object.keys(equals.value).length === 0) {
        this.add("schema.constraint", "attributes.equals must be a non-empty object.", [...at, "equals"], equals.node);
      } else {
        for (const [name, scalar] of Object.entries(equals.value)) {
          this.attributeName(name, equals.node?.keys?.get(name), [...at, "equals", name]);
          if (!(["boolean", "number", "string"] as const).includes(typeof scalar as "boolean" | "number" | "string")) {
            this.add("schema.type", "Attribute equality values must be strings, numbers, or booleans.", [...at, "equals", name], equals.node?.properties?.get(name));
          }
        }
      }
    }
    const ranges = this.property(value, node, "ranges");
    if (ranges.value !== undefined) this.attributeRanges(ranges.value, ranges.node, [...at, "ranges"]);
  }

  private attributeRanges(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value) || Object.keys(value).length === 0) {
      this.add("schema.constraint", "attributes.ranges must be a non-empty object.", at, node);
      return;
    }
    for (const [name, range] of Object.entries(value)) {
      const rangeNode = node?.properties?.get(name);
      this.attributeName(name, node?.keys?.get(name), [...at, name]);
      if (!isObject(range)) {
        this.add("schema.type", "An attribute range must be an object.", [...at, name], rangeNode);
        continue;
      }
      this.unknown(range, rangeNode, [...at, name], ["min", "max"]);
      if (range.min === undefined && range.max === undefined) {
        this.add("schema.constraint", "An attribute range requires min or max.", [...at, name], rangeNode);
      }
      for (const key of ["min", "max"] as const) {
        if (range[key] !== undefined && (typeof range[key] !== "number" || !Number.isFinite(range[key]))) {
          this.add("schema.type", `Attribute range ${key} must be a finite number.`, [...at, name, key], rangeNode?.properties?.get(key));
        }
      }
      if (typeof range.min === "number" && typeof range.max === "number" && range.min > range.max) {
        this.add("schema.constraint", "Attribute range min must not exceed max.", [...at, name], rangeNode);
      }
    }
  }

  private validateChildren(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!isObject(value)) {
      this.add("schema.type", "children must be an object.", at, node);
      return;
    }
    this.unknown(value, node, at, ["allowed", "required", "order"]);
    const present = ["allowed", "required", "order"].filter((key) => value[key] !== undefined);
    if (present.length === 0) this.add("schema.constraint", "children must contain a constraint.", at, node);
    const allowed = this.property(value, node, "allowed");
    if (allowed.value !== undefined) this.selector(allowed.value, allowed.node, [...at, "allowed"]);
    for (const key of ["required", "order"] as const) {
      const property = this.property(value, node, key);
      if (property.value !== undefined) this.selectorArray(property.value, property.node, [...at, key]);
    }
  }

  private selectorArray(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!Array.isArray(value) || value.length === 0) {
      this.add("schema.constraint", "Selector lists must be non-empty arrays.", at, node);
      return;
    }
    value.forEach((selector, index) => this.selector(selector, node?.items?.[index], [...at, index]));
  }

  private selector(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (typeof value !== "string" || value.length === 0) {
      this.add("schema.type", "A selector must be a non-empty string.", at, node);
      return;
    }
    const compiled = compileSelector(value);
    if (!compiled.ok) this.add("schema.selector", `Invalid selector: ${compiled.diagnostics[0].message}`, at, node);
  }

  private pattern(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (typeof value !== "string") {
      this.add("schema.type", "A pattern must be a string.", at, node);
      return;
    }
    try {
      RE2JS.compile(value);
    } catch {
      this.add("schema.pattern", "Invalid regular expression pattern.", at, node);
    }
  }

  private attributeNames(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!Array.isArray(value) || value.length === 0) {
      this.add("schema.constraint", "Required attributes must be a non-empty array.", at, node);
      return;
    }
    value.forEach((name, index) => {
      if (typeof name !== "string") this.add("schema.type", "An attribute name must be a string.", [...at, index], node?.items?.[index]);
      else this.attributeName(name, node?.items?.[index], [...at, index]);
    });
  }

  private attributeName(name: string, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/u.test(name)) this.add("schema.constraint", "Invalid attribute name.", at, node);
  }

  private stringArray(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (!Array.isArray(value)) {
      this.add("schema.type", "Expected an array of strings.", at, node);
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== "string") this.add("schema.type", "Expected a string.", [...at, index], node?.items?.[index]);
    });
  }

  private nonNegativeInteger(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[]): void {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      this.add("schema.type", "Expected a non-negative integer.", at, node);
    }
  }

  private nonEmptyString(value: JsonValue, node: JsonNode | undefined, at: readonly (number | string)[], name: string): value is string {
    if (typeof value !== "string" || value.length === 0) {
      this.add("schema.type", `${name} must be a non-empty string.`, at, node);
      return false;
    }
    return true;
  }

  private optionalString(object: JsonObject, node: JsonNode | undefined, key: string, at: readonly (number | string)[]): void {
    const property = this.property(object, node, key);
    if (property.value !== undefined && typeof property.value !== "string") {
      this.add("schema.type", `${key} must be a string.`, [...at, key], property.node);
    }
  }

  private unknown(object: JsonObject, node: JsonNode | undefined, at: readonly (number | string)[], allowed: readonly string[]): void {
    for (const key of Object.keys(object)) {
      if (allowed.includes(key) || (this.extensions && key.startsWith("x-"))) continue;
      this.add("schema.unknown-key", `Unknown key ${JSON.stringify(key)}.`, [...at, key], node?.keys?.get(key) ?? node?.properties?.get(key));
    }
  }

  private property(object: JsonObject, node: JsonNode | undefined, key: string): { readonly value: JsonValue | undefined; readonly node: JsonNode | undefined } {
    return { value: object[key], node: node?.properties?.get(key) };
  }

  private add(code: string, message: string, at: readonly (number | string)[], node: JsonNode | undefined): void {
    const diagnostic: Diagnostic = {
      code,
      severity: "error",
      message: `At ${pointer(at)}: ${message}`,
      source: "schema",
      ...(this.options.path === undefined ? {} : { path: this.options.path }),
      ...(this.source === undefined || node === undefined ? {} : { range: jsonRange(this.source, node) }),
    };
    this.diagnostics.push(deepFreeze(diagnostic));
  }
}

class TypedJsonError extends Error {
  readonly at: readonly (number | string)[];

  constructor(at: readonly (number | string)[], message: string) {
    super(message);
    this.at = at;
  }
}

const typedJson = (
  input: unknown,
  at: readonly (number | string)[] = [],
  ancestors: ReadonlySet<object> = new Set(),
): JsonValue => {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypedJsonError(at, "Numbers must be finite.");
    return input;
  }
  if (typeof input !== "object") throw new TypedJsonError(at, "Values must be portable JSON data.");
  if (ancestors.has(input)) throw new TypedJsonError(at, "Schema input must not contain cycles.");
  const next = new Set(ancestors).add(input);
  if (Array.isArray(input)) return input.map((value, index) => typedJson(value, [...at, index], next));
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypedJsonError(at, "Objects must be plain JSON objects.");
  }
  const result: Record<string, JsonValue> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol") {
      throw new TypedJsonError(at, "Symbol keys are not portable JSON data.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw new TypedJsonError([...at, key], "Properties must be enumerable data values.");
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: typedJson(descriptor.value, [...at, key], next),
      writable: true,
    });
  }
  return result;
};

const sourceDiagnostic = (
  error: JsonSourceError,
  source: string,
  options: SchemaLoadOptions,
): Diagnostic =>
  deepFreeze({
    code: error.code,
    severity: "error" as const,
    message: error.message,
    source: "schema" as const,
    ...(options.path === undefined ? {} : { path: options.path }),
    range: jsonRange(source, { start: error.start, end: error.end }),
  });

/** Strictly loads portable JSON source or its equivalent typed object. */
export const loadSchema = (
  input: unknown,
  options: SchemaLoadOptions = {},
): Result<MarkdownSchema> => {
  let value: JsonValue;
  let node: JsonNode | undefined;
  let source: string | undefined;
  if (typeof input === "string") {
    source = input;
    try {
      const parsed = new JsonReader(input).parse();
      value = parsed.value;
      node = parsed.node;
    } catch (error) {
      if (!(error instanceof JsonSourceError)) throw error;
      return failure(sourceDiagnostic(error, input, options));
    }
  } else {
    try {
      value = typedJson(input);
    } catch (error) {
      if (!(error instanceof TypedJsonError)) throw error;
      const diagnostic: Diagnostic = deepFreeze({
        code: "schema.type",
        severity: "error" as const,
        message: `At ${pointer(error.at)}: ${error.message}`,
        source: "schema" as const,
        ...(options.path === undefined ? {} : { path: options.path }),
      });
      return failure(diagnostic);
    }
  }
  const validator = new SchemaValidator(value, node, source, options).validate();
  const [first, ...rest] = validator.diagnostics;
  if (first !== undefined) return failure(first, ...rest);
  return success(deepFreeze(value) as unknown as MarkdownSchema);
};

/** Internal strict JSON parser shared by JSON frontmatter decoding. */
export const parseJsonValue = (
  source: string,
  options: SchemaLoadOptions = {},
): Result<JsonValue> => {
  try {
    return success(deepFreeze(new JsonReader(source).parse().value));
  } catch (error) {
    if (!(error instanceof JsonSourceError)) throw error;
    return failure(sourceDiagnostic(error, source, options));
  }
};
