import { RE2JS } from "re2js";

import type { Diagnostic, DiagnosticNote } from "./diagnostic.ts";
import { nodeMarkdown } from "./expression.ts";
import { decodeFrontmatter } from "./frontmatter.ts";
import { validateJsonSchema } from "./json-schema.ts";
import type { Document, MarkdownNode } from "./model.ts";
import {
  compileSelector,
  schemaNodeAttribute,
  schemaNodeChildren,
  schemaNodeText,
  select,
  type CompiledSelector,
} from "./selector.ts";
import {
  schemaSourceMetadata,
  type MarkdownSchema,
  type MarkdownSchemaRule,
  type SchemaChildrenConstraint,
} from "./schema.ts";

interface OrderedDiagnostic {
  readonly diagnostic: Diagnostic;
  readonly rule: number;
  readonly serial: number;
}

const compiledSelectors = new Map<string, CompiledSelector>();
const compiledPatterns = new Map<string, RE2JS>();

const selector = (source: string): CompiledSelector => {
  const cached = compiledSelectors.get(source);
  if (cached !== undefined) return cached;
  const result = compileSelector(source);
  if (!result.ok) throw new TypeError("loaded schema contains an invalid selector");
  compiledSelectors.set(source, result.value);
  return result.value;
};

const pattern = (source: string): RE2JS => {
  const cached = compiledPatterns.get(source);
  if (cached !== undefined) return cached;
  const compiled = RE2JS.compile(source);
  compiledPatterns.set(source, compiled);
  return compiled;
};

const frozenNote = (node: MarkdownNode, path: string | undefined): DiagnosticNote =>
  Object.freeze({
    message: "First occurrence is here.",
    ...(path === undefined ? {} : { path }),
    range: node.range,
  });

const diagnostic = (
  code: string,
  message: string,
  node: MarkdownNode,
  document: Document,
  rule: MarkdownSchemaRule | undefined,
  notes: readonly DiagnosticNote[] = [],
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error" as const,
    message: rule?.message === undefined ? message : `${message} ${rule.message}`,
    source: "schema" as const,
    ...(document.path === undefined ? {} : { path: document.path }),
    range: node.range,
    ...(notes.length === 0 ? {} : { notes: Object.freeze([...notes]) }),
  });

const directMatches = (
  parent: MarkdownNode,
  compiled: CompiledSelector,
): ReadonlySet<MarkdownNode> => {
  const children = new Set(schemaNodeChildren(parent));
  return new Set(
    select(parent, compiled, { includeRoot: false }).filter((node) => children.has(node)),
  );
};

const projection = (
  document: Document,
  node: MarkdownNode,
  name: string,
): string | number | boolean | undefined => {
  if (name === "text") return schemaNodeText(node);
  if (name === "markdown") return nodeMarkdown(document, node);
  return schemaNodeAttribute(node, name);
};

/** Evaluates a loaded schema without defining the later public validation result API. */
export const validateSchema = (
  document: Document,
  schema: MarkdownSchema,
): readonly Diagnostic[] => {
  const ordered: OrderedDiagnostic[] = [];
  const metadata = schemaSourceMetadata(schema);
  let serial = 0;
  const add = (
    code: string,
    message: string,
    node: MarkdownNode,
    ruleIndex: number,
    rule: MarkdownSchemaRule | undefined,
    notes: readonly DiagnosticNote[] = [],
  ): void => {
    const ruleRange = ruleIndex < 0 ? undefined : metadata?.rules[ruleIndex];
    const contextualNotes =
      ruleIndex < 0 || metadata === undefined
        ? notes
        : [
            ...notes,
            Object.freeze({
              message: `Schema rule ${ruleIndex + 1} is defined here.`,
              ...(metadata.path === undefined ? {} : { path: metadata.path }),
              ...(ruleRange === undefined ? {} : { range: ruleRange }),
            }),
          ];
    ordered.push({
      diagnostic: diagnostic(code, message, node, document, rule, contextualNotes),
      rule: ruleIndex,
      serial: serial++,
    });
  };

  if (schema.options?.headingRanks === "contiguous") {
    const headings = select(document, selector("heading"));
    let previous = 0;
    for (const heading of headings) {
      const level = schemaNodeAttribute(heading, "level");
      if (typeof level !== "number") continue;
      if (level > previous + 1) {
        add(
          "schema.heading-ranks",
          `Heading rank ${level} skips rank ${previous + 1}.`,
          heading,
          -1,
          undefined,
        );
      }
      previous = level;
    }
  }

  if (schema.frontmatter !== undefined) {
    const nodes = select(document, selector("frontmatter"));
    for (const node of nodes) {
      if (node.type !== "frontmatter") continue;
      const decoded = decodeFrontmatter(
        node,
        document.path === undefined ? {} : { path: document.path },
      );
      if (!decoded.ok) {
        for (const value of decoded.diagnostics) {
          ordered.push({ diagnostic: value, rule: -1, serial: serial++ });
        }
        continue;
      }
      for (const error of validateJsonSchema(schema.frontmatter, decoded.value)) {
        const location = error.instancePath.length === 0 ? "/" : error.instancePath;
        add(
          "schema.frontmatter",
          `Frontmatter ${location} fails ${JSON.stringify(error.keyword)}: ${error.message ?? "invalid value"}.`,
          node,
          -1,
          undefined,
        );
      }
    }
  }

  schema.rules.forEach((rule, ruleIndex) => {
    const matches = select(document, selector(rule.selector));
    if (rule.count !== undefined) {
      const actual = matches.length;
      const countNode =
        rule.count.max !== undefined && actual > rule.count.max
          ? matches[rule.count.max]!
          : rule.count.exact !== undefined && actual > rule.count.exact
            ? matches[rule.count.exact]!
            : document;
      if (rule.count.exact !== undefined && actual !== rule.count.exact) {
        add("schema.count", `Expected exactly ${rule.count.exact} matches; found ${actual}.`, countNode, ruleIndex, rule);
      } else {
        if (rule.count.min !== undefined && actual < rule.count.min) {
          add("schema.count", `Expected at least ${rule.count.min} matches; found ${actual}.`, document, ruleIndex, rule);
        }
        if (rule.count.max !== undefined && actual > rule.count.max) {
          add("schema.count", `Expected at most ${rule.count.max} matches; found ${actual}.`, countNode, ruleIndex, rule);
        }
      }
    }

    for (const node of matches) {
      const text = schemaNodeText(node);
      if (rule.text?.minLength !== undefined && [...text].length < rule.text.minLength) {
        add("schema.text-min-length", `Plain text has ${[...text].length} characters; expected at least ${rule.text.minLength}.`, node, ruleIndex, rule);
      }
      if (rule.text?.maxLength !== undefined && [...text].length > rule.text.maxLength) {
        add("schema.text-max-length", `Plain text has ${[...text].length} characters; expected at most ${rule.text.maxLength}.`, node, ruleIndex, rule);
      }
      if (rule.text?.pattern !== undefined && !pattern(rule.text.pattern).test(text)) {
        add("schema.text-pattern", `Plain text does not match pattern ${JSON.stringify(rule.text.pattern)}.`, node, ruleIndex, rule);
      }
      if (rule.text?.enum !== undefined && !rule.text.enum.includes(text)) {
        add("schema.text-enum", `Plain text ${JSON.stringify(text)} is not one of ${JSON.stringify(rule.text.enum)}.`, node, ruleIndex, rule);
      }
      if (
        rule.markdown?.pattern !== undefined &&
        !pattern(rule.markdown.pattern).test(nodeMarkdown(document, node))
      ) {
        add("schema.markdown-pattern", `Markdown does not match pattern ${JSON.stringify(rule.markdown.pattern)}.`, node, ruleIndex, rule);
      }
      for (const name of rule.attributes?.required ?? []) {
        if (schemaNodeAttribute(node, name) === undefined) {
          add("schema.attribute-required", `Required attribute ${JSON.stringify(name)} is missing.`, node, ruleIndex, rule);
        }
      }
      for (const [name, expected] of Object.entries(rule.attributes?.equals ?? {})) {
        const actual = schemaNodeAttribute(node, name);
        if (actual !== expected) {
          add("schema.attribute-equals", `Attribute ${JSON.stringify(name)} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`, node, ruleIndex, rule);
        }
      }
      for (const [name, range] of Object.entries(rule.attributes?.ranges ?? {})) {
        const actual = schemaNodeAttribute(node, name);
        if (
          typeof actual !== "number" ||
          (range.min !== undefined && actual < range.min) ||
          (range.max !== undefined && actual > range.max)
        ) {
          const bounds = `${range.min === undefined ? "-∞" : range.min}..${range.max === undefined ? "+∞" : range.max}`;
          add("schema.attribute-range", `Attribute ${JSON.stringify(name)} is ${JSON.stringify(actual)}; expected range ${bounds}.`, node, ruleIndex, rule);
        }
      }
      if (rule.children !== undefined) {
        validateChildren(node, rule.children, rule, ruleIndex, add);
      }
    }

    if (rule.unique !== undefined) {
      const seen = new Map<string, MarkdownNode>();
      for (const node of matches) {
        const value = projection(document, node, rule.unique);
        if (value === undefined) {
          add("schema.unique", `Unique projection ${JSON.stringify(rule.unique)} is unavailable.`, node, ruleIndex, rule);
          continue;
        }
        const key = `${typeof value}:${JSON.stringify(value)}`;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, node);
        else {
          add(
            "schema.unique",
            `Projection ${JSON.stringify(rule.unique)} must be unique.`,
            node,
            ruleIndex,
            rule,
            [frozenNote(first, document.path)],
          );
        }
      }
    }
  });

  ordered.sort(
    (left, right) =>
      left.diagnostic.range!.start.byteOffset - right.diagnostic.range!.start.byteOffset ||
      left.rule - right.rule ||
      left.serial - right.serial,
  );
  return Object.freeze(ordered.map(({ diagnostic: value }) => value));
};

const validateChildren = (
  parent: MarkdownNode,
  constraint: SchemaChildrenConstraint,
  rule: MarkdownSchemaRule,
  ruleIndex: number,
  add: (
    code: string,
    message: string,
    node: MarkdownNode,
    ruleIndex: number,
    rule: MarkdownSchemaRule,
  ) => void,
): void => {
  const children = schemaNodeChildren(parent);
  if (constraint.allowed !== undefined) {
    const allowed = directMatches(parent, selector(constraint.allowed));
    for (const child of children) {
      if (!allowed.has(child)) {
        add("schema.child-allowed", `Child ${JSON.stringify(child.type)} is not allowed.`, child, ruleIndex, rule);
      }
    }
  }
  for (const required of constraint.required ?? []) {
    if (directMatches(parent, selector(required)).size === 0) {
      add("schema.child-required", `Required child selector ${JSON.stringify(required)} did not match.`, parent, ruleIndex, rule);
    }
  }
  if (constraint.order !== undefined) {
    const groups = constraint.order.map((source) => directMatches(parent, selector(source)));
    let highest = -1;
    for (const child of children) {
      const index = groups.findIndex((group) => group.has(child));
      if (index === -1) continue;
      if (index < highest) {
        add("schema.child-order", "Child appears outside the required selector order.", child, ruleIndex, rule);
      } else {
        highest = index;
      }
    }
  }
};
