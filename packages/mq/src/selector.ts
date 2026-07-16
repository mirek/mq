import {
  Reader,
  Result as ParserResult,
  regexp,
  type Parser,
} from "@prelude/parser";
import { RE2JS } from "re2js";

import type { Diagnostic } from "./diagnostic.ts";
import type { MarkdownNode } from "./model.ts";
import { inlines } from "./parse.ts";
import { failure, success, type Result } from "./result.ts";
import { sourcePosition, sourceRange } from "./source.ts";

type AttributeValue = string | number | boolean;
type AttributeOperator =
  | "present"
  | "="
  | "!="
  | "^="
  | "$="
  | "*="
  | "~="
  | ">"
  | ">="
  | "<"
  | "<=";
type Combinator = "child" | "descendant" | "adjacent" | "sibling";

interface AttributeSelector {
  readonly name: string;
  readonly operator: AttributeOperator;
  readonly value?: AttributeValue;
}

interface FirstChildPseudo {
  readonly kind: "first-child";
}

interface LastChildPseudo {
  readonly kind: "last-child";
}

interface NthChildPseudo {
  readonly kind: "nth-child";
  readonly index: number;
}

interface ContainsPseudo {
  readonly kind: "contains";
  readonly value: string;
}

interface MatchesPseudo {
  readonly kind: "matches";
  readonly pattern: RE2JS;
}

interface HasPseudo {
  readonly kind: "has";
  readonly program: SelectorProgram;
}

interface NotPseudo {
  readonly kind: "not";
  readonly program: SelectorProgram;
}

type Pseudo =
  | FirstChildPseudo
  | LastChildPseudo
  | NthChildPseudo
  | ContainsPseudo
  | MatchesPseudo
  | HasPseudo
  | NotPseudo;

interface CompoundSelector {
  readonly type: string;
  readonly attributes: readonly AttributeSelector[];
  readonly pseudos: readonly Pseudo[];
}

interface SelectorStep {
  readonly combinator?: Combinator;
  readonly compound: CompoundSelector;
}

interface SelectorProgram {
  readonly selectors: readonly (readonly SelectorStep[])[];
}

interface ParseState {
  readonly source: string;
  offset: number;
  nesting: number;
  selectors: number;
  steps: number;
  tests: number;
}

interface SelectionContext {
  readonly ordered: readonly MarkdownNode[];
  readonly parents: ReadonlyMap<MarkdownNode, MarkdownNode>;
}

/** An immutable, reusable selector program produced by {@link compileSelector}. */
export interface CompiledSelector {
  readonly source: string;
}

/** Options controlling whether selection begins with or below the supplied root. */
export interface SelectOptions {
  readonly includeRoot?: boolean;
}

const attributeTypes = new Map<string, "boolean" | "number" | "string">([
  ["alignment", "string"],
  ["checked", "boolean"],
  ["destination", "string"],
  ["fenced", "boolean"],
  ["format", "string"],
  ["header", "boolean"],
  ["language", "string"],
  ["label", "string"],
  ["level", "number"],
  ["meta", "string"],
  ["ordered", "boolean"],
  ["path", "string"],
  ["reason", "string"],
  ["reference", "string"],
  ["slug", "string"],
  ["start", "number"],
  ["style", "string"],
  ["tight", "boolean"],
  ["title", "string"],
  ["value", "string"],
]);

const whitespace = regexp(/\s*/u);
const identifier = regexp(/[A-Za-z][A-Za-z0-9-]*/u);
const positiveInteger = regexp(/[1-9]\d*/u);
const quotedValue = regexp(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/su);
const unquotedValue = regexp(/[^\s\]]+/u);
const maxRegexPatternLength = 256;
const maxSelectorBytes = 65_536;
const maxSelectorListLength = 64;
const maxSelectorSteps = 256;
const maxSelectorTests = 256;
const maxSelectorNesting = 16;

class SelectorCompileError extends Error {
  readonly code: string;

  constructor(message: string, code = "selector.syntax") {
    super(message);
    this.code = code;
  }
}

class SelectorTypeError extends SelectorCompileError {
  constructor(message: string) {
    super(message, "selector.attribute-type");
  }
}

class SelectorRegexError extends SelectorCompileError {
  constructor(message: string) {
    super(message, "selector.regex");
  }
}

class SelectorLimitError extends SelectorCompileError {
  constructor(message: string) {
    super(message, "selector.limit");
  }
}

const increment = (
  state: ParseState,
  field: "selectors" | "steps" | "tests",
  maximum: number,
): void => {
  state[field] += 1;
  if (state[field] > maximum) {
    throw new SelectorLimitError(
      `Selector ${field} are limited to ${maximum}.`,
    );
  }
};

const parseToken = <T>(
  parser: Parser<T>,
  state: ParseState,
  message: string,
): T => {
  const result = parser(Reader.of(state.source, state.offset));
  if (ParserResult.failed(result)) throw new SelectorCompileError(message);
  state.offset = result.reader.offset;
  return result.value;
};

const skipWhitespace = (state: ParseState): boolean => {
  const start = state.offset;
  parseToken(whitespace, state, "Expected whitespace.");
  return state.offset > start;
};

const expect = (state: ParseState, value: string, message: string): void => {
  if (!state.source.startsWith(value, state.offset)) {
    throw new SelectorCompileError(message);
  }
  state.offset += value.length;
};

const decodeQuoted = (raw: string): string =>
  raw
    .slice(1, -1)
    .replace(/\\([\s\S])/gu, (_match, escaped: string) => escaped);

const decodeAttributeValue = (
  name: string,
  rawValue: string,
): AttributeValue => {
  const expected = attributeTypes.get(name) ?? "string";
  const quoted = rawValue.startsWith('"') || rawValue.startsWith("'");
  const decoded = quoted ? decodeQuoted(rawValue) : rawValue;

  if (expected === "number") {
    if (quoted || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(decoded)) {
      throw new SelectorTypeError(
        `Attribute ${name} requires an unquoted numeric value.`,
      );
    }
    return Number(decoded);
  }

  if (expected === "boolean") {
    if (quoted || (decoded !== "true" && decoded !== "false")) {
      throw new SelectorTypeError(
        `Attribute ${name} requires true or false.`,
      );
    }
    return decoded === "true";
  }

  return decoded;
};

const parseAttributeOperator = (state: ParseState): AttributeOperator => {
  for (const operator of [
    "!=",
    "^=",
    "$=",
    "*=",
    "~=",
    ">=",
    "<=",
    "=",
    ">",
    "<",
  ] as const) {
    if (state.source.startsWith(operator, state.offset)) {
      state.offset += operator.length;
      return operator;
    }
  }
  throw new SelectorCompileError("Expected an attribute operator or closing bracket.");
};

const parseAttribute = (state: ParseState): AttributeSelector => {
  increment(state, "tests", maxSelectorTests);
  expect(state, "[", 'Expected "[".');
  skipWhitespace(state);
  const name = parseToken(
    identifier,
    state,
    "Expected an attribute name.",
  ).toLowerCase();
  skipWhitespace(state);

  if (state.source[state.offset] === "]") {
    state.offset += 1;
    return Object.freeze({ name, operator: "present" });
  }

  const operator = parseAttributeOperator(state);
  const expectedType = attributeTypes.get(name) ?? "string";
  if (
    (operator === ">" ||
      operator === ">=" ||
      operator === "<" ||
      operator === "<=") &&
    expectedType !== "number"
  ) {
    throw new SelectorTypeError(
      `Ordered comparison requires a numeric attribute; ${name} is ${expectedType}.`,
    );
  }
  if (
    (operator === "^=" ||
      operator === "$=" ||
      operator === "*=" ||
      operator === "~=") &&
    expectedType !== "string"
  ) {
    throw new SelectorTypeError(
      `Operator ${operator} requires a string attribute; ${name} is ${expectedType}.`,
    );
  }

  skipWhitespace(state);
  const rawValue = parseToken(
    state.source[state.offset] === '"' || state.source[state.offset] === "'"
      ? quotedValue
      : unquotedValue,
    state,
    "Expected an attribute value.",
  );
  skipWhitespace(state);
  expect(state, "]", 'Expected "]" after attribute value.');

  return Object.freeze({
    name,
    operator,
    value: decodeAttributeValue(name, rawValue),
  });
};

const regexFlags = (source: string): number => {
  let flags = 0;
  const seen = new Set<string>();
  for (const flag of source) {
    if (seen.has(flag) || !"imsu".includes(flag)) {
      throw new SelectorRegexError(`Unsupported regular-expression flags ${JSON.stringify(source)}.`);
    }
    seen.add(flag);
    if (flag === "i") flags |= RE2JS.CASE_INSENSITIVE;
    if (flag === "m") flags |= RE2JS.MULTILINE;
    if (flag === "s") flags |= RE2JS.DOTALL;
  }
  return flags;
};

const parseRegex = (state: ParseState): RE2JS => {
  expect(state, "/", 'Expected "/" to start a regular expression.');
  const patternStart = state.offset;
  let escaped = false;
  let inClass = false;

  while (state.offset < state.source.length) {
    const character = state.source[state.offset]!;
    if (escaped) {
      escaped = false;
      state.offset += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      state.offset += 1;
      continue;
    }
    if (character === "[" && !inClass) {
      inClass = true;
      state.offset += 1;
      continue;
    }
    if (character === "]" && inClass) {
      inClass = false;
      state.offset += 1;
      continue;
    }
    if (character === "/" && !inClass) break;
    state.offset += 1;
  }

  if (state.source[state.offset] !== "/") {
    throw new SelectorRegexError("Regular expression requires a closing slash.");
  }
  const patternSource = state.source.slice(patternStart, state.offset);
  state.offset += 1;
  const flagsStart = state.offset;
  while (/[A-Za-z]/u.test(state.source[state.offset] ?? "")) state.offset += 1;
  const flagSource = state.source.slice(flagsStart, state.offset);

  if (patternSource.length > maxRegexPatternLength) {
    throw new SelectorRegexError(
      `Regular-expression patterns are limited to ${maxRegexPatternLength} characters.`,
    );
  }

  try {
    return RE2JS.compile(patternSource, regexFlags(flagSource));
  } catch (error) {
    if (error instanceof SelectorCompileError) throw error;
    throw new SelectorRegexError(
      error instanceof Error ? error.message : "Invalid regular expression.",
    );
  }
};

const parseSelectorList = (
  state: ParseState,
  allowRelative: boolean,
  terminator?: string,
): SelectorProgram => {
  const selectors: (readonly SelectorStep[])[] = [];
  skipWhitespace(state);

  while (true) {
    if (
      state.offset >= state.source.length ||
      (terminator !== undefined && state.source[state.offset] === terminator)
    ) {
      throw new SelectorCompileError("Expected a selector.");
    }
    increment(state, "selectors", maxSelectorListLength);
    selectors.push(parseSequence(state, allowRelative, terminator));
    skipWhitespace(state);
    if (state.source[state.offset] !== ",") break;
    state.offset += 1;
    skipWhitespace(state);
  }

  return Object.freeze({ selectors: Object.freeze(selectors) });
};

const parsePseudo = (state: ParseState): Pseudo => {
  increment(state, "tests", maxSelectorTests);
  expect(state, ":", 'Expected ":".');
  const name = parseToken(identifier, state, "Expected a pseudo name.").toLowerCase();

  if (name === "first-child" || name === "last-child") {
    return Object.freeze({ kind: name });
  }

  if (name === "nth-child") {
    expect(state, "(", 'Expected "(" after :nth-child.');
    skipWhitespace(state);
    const index = Number(
      parseToken(positiveInteger, state, ":nth-child requires a positive integer."),
    );
    skipWhitespace(state);
    expect(state, ")", 'Expected ")" after :nth-child argument.');
    return Object.freeze({ kind: "nth-child", index });
  }

  if (name === "contains") {
    expect(state, "(", 'Expected "(" after :contains.');
    skipWhitespace(state);
    const raw = parseToken(
      quotedValue,
      state,
      ":contains requires a quoted string.",
    );
    skipWhitespace(state);
    expect(state, ")", 'Expected ")" after :contains argument.');
    return Object.freeze({ kind: "contains", value: decodeQuoted(raw) });
  }

  if (name === "matches") {
    expect(state, "(", 'Expected "(" after :matches.');
    skipWhitespace(state);
    const pattern = parseRegex(state);
    skipWhitespace(state);
    expect(state, ")", 'Expected ")" after :matches argument.');
    return Object.freeze({ kind: "matches", pattern });
  }

  if (name === "has" || name === "not") {
    expect(state, "(", `Expected "(" after :${name}.`);
    state.nesting += 1;
    if (state.nesting > maxSelectorNesting) {
      throw new SelectorLimitError(
        `Selector nesting is limited to ${maxSelectorNesting}.`,
      );
    }
    const program = parseSelectorList(state, name === "has", ")");
    state.nesting -= 1;
    skipWhitespace(state);
    expect(state, ")", `Expected ")" after :${name} argument.`);
    return Object.freeze({ kind: name, program });
  }

  throw new SelectorCompileError(`Unknown pseudo :${name}.`);
};

const startsCompound = (character: string | undefined): boolean =>
  character === "*" ||
  character === "[" ||
  character === ":" ||
  (character !== undefined && /[A-Za-z]/u.test(character));

const parseCompound = (state: ParseState): CompoundSelector => {
  let type = "*";
  if (state.source[state.offset] === "*") {
    state.offset += 1;
  } else if (/[A-Za-z]/u.test(state.source[state.offset] ?? "")) {
    type = parseToken(identifier, state, "Expected a node type.").toLowerCase();
  } else if (
    state.source[state.offset] !== "[" &&
    state.source[state.offset] !== ":"
  ) {
    throw new SelectorCompileError("Expected a compound selector.");
  }

  const attributes: AttributeSelector[] = [];
  const pseudos: Pseudo[] = [];
  while (true) {
    if (state.source[state.offset] === "[") {
      attributes.push(parseAttribute(state));
    } else if (state.source[state.offset] === ":") {
      pseudos.push(parsePseudo(state));
    } else {
      break;
    }
  }

  return Object.freeze({
    type,
    attributes: Object.freeze(attributes),
    pseudos: Object.freeze(pseudos),
  });
};

const explicitCombinator = (state: ParseState): Combinator | undefined => {
  const character = state.source[state.offset];
  if (character === ">") {
    state.offset += 1;
    return "child";
  }
  if (character === "+") {
    state.offset += 1;
    return "adjacent";
  }
  if (character === "~") {
    state.offset += 1;
    return "sibling";
  }
  return undefined;
};

function parseSequence(
  state: ParseState,
  allowRelative: boolean,
  terminator?: string,
): readonly SelectorStep[] {
  const steps: SelectorStep[] = [];
  let firstCombinator: Combinator | undefined;
  if (allowRelative) {
    firstCombinator = explicitCombinator(state);
    if (firstCombinator !== undefined) skipWhitespace(state);
  }
  increment(state, "steps", maxSelectorSteps);
  steps.push(
    Object.freeze({
      ...(firstCombinator === undefined ? {} : { combinator: firstCombinator }),
      compound: parseCompound(state),
    }),
  );

  while (true) {
    const separated = skipWhitespace(state);
    if (
      state.offset >= state.source.length ||
      state.source[state.offset] === "," ||
      (terminator !== undefined && state.source[state.offset] === terminator)
    ) {
      break;
    }

    const explicit = explicitCombinator(state);
    if (explicit !== undefined) {
      skipWhitespace(state);
      increment(state, "steps", maxSelectorSteps);
      steps.push(
        Object.freeze({ combinator: explicit, compound: parseCompound(state) }),
      );
      continue;
    }
    if (separated && startsCompound(state.source[state.offset])) {
      increment(state, "steps", maxSelectorSteps);
      steps.push(
        Object.freeze({
          combinator: "descendant",
          compound: parseCompound(state),
        }),
      );
      continue;
    }
    throw new SelectorCompileError("Expected a selector combinator.");
  }

  return Object.freeze(steps);
}

const parseSelector = (source: string): SelectorProgram => {
  if (Buffer.byteLength(source) > maxSelectorBytes) {
    throw new SelectorLimitError(
      `Selector source is limited to ${maxSelectorBytes} UTF-8 bytes.`,
    );
  }
  const state: ParseState = {
    source,
    offset: 0,
    nesting: 0,
    selectors: 0,
    steps: 0,
    tests: 0,
  };
  const program = parseSelectorList(state, false);
  skipWhitespace(state);
  if (state.offset !== source.length) {
    throw new SelectorCompileError("Unexpected selector input.");
  }
  return program;
};

const selectorRange = (source: string) => {
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;

  for (let index = 0; index < source.length; ) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      index += 2;
      byteOffset += 2;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }
    if (source[index] === "\r" || source[index] === "\n") {
      index += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }

    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    index += width;
    byteOffset +=
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    column += 1;
    utf16Column += width;
  }

  return sourceRange(
    sourcePosition(0, 1, 1, 1),
    sourcePosition(byteOffset, line, column, utf16Column),
  );
};

const diagnostic = (
  source: string,
  code: string,
  message: string,
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error",
    message,
    source: "selector",
    range: selectorRange(source),
  });

const programs = new WeakMap<CompiledSelector, SelectorProgram>();

/** Compiles the complete selector language into an immutable reusable value. */
export const compileSelector = (
  source: string,
): Result<CompiledSelector> => {
  try {
    const program = parseSelector(source);
    const compiled = Object.freeze({ source });
    programs.set(compiled, program);
    return success(compiled);
  } catch (error) {
    if (!(error instanceof SelectorCompileError)) throw error;
    return failure(diagnostic(source, error.code, error.message));
  }
};

const childrenOf = (node: MarkdownNode): readonly MarkdownNode[] => {
  if (
    node.type === "document" ||
    node.type === "section" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "item" ||
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "strikethrough" ||
    node.type === "table" ||
    node.type === "row" ||
    node.type === "link"
  ) {
    return node.children;
  }
  if (
    node.type === "heading" ||
    node.type === "paragraph" ||
    node.type === "cell"
  ) {
    return inlines(node);
  }
  return [];
};

const slug = (title: string): string =>
  title
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
    .replace(/\s/gu, "-");

const attributeOf = (
  node: MarkdownNode,
  name: string,
): AttributeValue | undefined => {
  if (name === "path" && node.type === "document") return node.path;
  if (name === "level" && (node.type === "section" || node.type === "heading")) {
    return node.level;
  }
  if (name === "title" && (node.type === "section" || node.type === "heading")) {
    return node.title;
  }
  if (name === "slug" && (node.type === "section" || node.type === "heading")) {
    return slug(node.title);
  }
  if (name === "style" && node.type === "heading") return node.style;
  if (name === "format" && node.type === "frontmatter") return node.format;
  if (name === "label" && node.type === "definition") return node.label;
  if (name === "ordered" && node.type === "list") return node.ordered;
  if (name === "start" && node.type === "list") return node.start;
  if (name === "tight" && node.type === "list") return node.tight;
  if (name === "checked" && node.type === "item") return node.checked;
  if (name === "alignment" && node.type === "cell") return node.alignment;
  if (name === "header" && (node.type === "row" || node.type === "cell")) {
    return node.header;
  }
  if (name === "language" && node.type === "code") return node.language;
  if (name === "meta" && node.type === "code") return node.meta;
  if (name === "fenced" && node.type === "code") return node.fenced;
  if (
    name === "destination" &&
    (node.type === "link" ||
      node.type === "image" ||
      node.type === "definition")
  ) {
    return node.destination;
  }
  if (
    name === "title" &&
    (node.type === "link" ||
      node.type === "image" ||
      node.type === "definition")
  ) {
    return node.title;
  }
  if (
    name === "reference" &&
    (node.type === "link" ||
      node.type === "image" ||
      node.type === "definition")
  ) {
    return node.reference;
  }
  if (name === "reason" && node.type === "opaque") return node.reason;
  if (
    name === "value" &&
    (node.type === "text" ||
      node.type === "inline-code" ||
      node.type === "code" ||
      node.type === "html" ||
      node.type === "frontmatter")
  ) {
    return node.value;
  }
  return undefined;
};

const semanticText = (node: MarkdownNode): string => {
  if (node.type === "heading") return node.title;
  if (node.type === "paragraph" || node.type === "cell") return node.text;
  if (
    node.type === "text" ||
    node.type === "inline-code" ||
    node.type === "code" ||
    node.type === "html"
  ) {
    return node.value;
  }
  if (node.type === "image") return node.alt;
  if (node.type === "break") return "\n";
  if (node.type === "frontmatter" || node.type === "definition") return "";
  if (
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "strikethrough" ||
    node.type === "link"
  ) {
    return node.children.map(semanticText).join("");
  }
  if (
    node.type === "document" ||
    node.type === "section" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "item" ||
    node.type === "table" ||
    node.type === "row"
  ) {
    return node.children.map(semanticText).join("\n");
  }
  return "";
};

/** Internal semantic helpers shared with schema rule evaluation. */
export const schemaNodeChildren = childrenOf;
export const schemaNodeAttribute = attributeOf;
export const schemaNodeText = semanticText;

const matchesAttribute = (
  node: MarkdownNode,
  selector: AttributeSelector,
): boolean => {
  const actual = attributeOf(node, selector.name);
  if (selector.operator === "present") return actual !== undefined;
  if (actual === undefined || selector.value === undefined) return false;

  if (selector.operator === "=") return actual === selector.value;
  if (selector.operator === "!=") return actual !== selector.value;
  if (typeof actual === "number" && typeof selector.value === "number") {
    if (selector.operator === ">") return actual > selector.value;
    if (selector.operator === ">=") return actual >= selector.value;
    if (selector.operator === "<") return actual < selector.value;
    if (selector.operator === "<=") return actual <= selector.value;
  }
  if (typeof actual === "string" && typeof selector.value === "string") {
    if (selector.operator === "^=") return actual.startsWith(selector.value);
    if (selector.operator === "$=") return actual.endsWith(selector.value);
    if (selector.operator === "*=") return actual.includes(selector.value);
    if (selector.operator === "~=") {
      return actual.split(/[\t\n\f\r ]+/u).includes(selector.value);
    }
  }
  return false;
};

const siblingsOf = (
  node: MarkdownNode,
  context: SelectionContext,
): readonly MarkdownNode[] => {
  const parent = context.parents.get(node);
  return parent === undefined ? [] : childrenOf(parent);
};

const previousSibling = (
  node: MarkdownNode,
  context: SelectionContext,
): MarkdownNode | undefined => {
  const siblings = siblingsOf(node, context);
  const index = siblings.indexOf(node);
  return index > 0 ? siblings[index - 1] : undefined;
};

const previousSiblings = (
  node: MarkdownNode,
  context: SelectionContext,
): readonly MarkdownNode[] => {
  const siblings = siblingsOf(node, context);
  const index = siblings.indexOf(node);
  return index <= 0 ? [] : siblings.slice(0, index);
};

const isDescendant = (
  node: MarkdownNode,
  ancestor: MarkdownNode,
  context: SelectionContext,
): boolean => {
  for (
    let parent = context.parents.get(node);
    parent !== undefined;
    parent = context.parents.get(parent)
  ) {
    if (parent === ancestor) return true;
  }
  return false;
};

const relatedToAnchor = (
  node: MarkdownNode,
  anchor: MarkdownNode,
  combinator: Combinator,
  context: SelectionContext,
): boolean => {
  if (combinator === "descendant") return isDescendant(node, anchor, context);
  if (combinator === "child") return context.parents.get(node) === anchor;
  if (combinator === "adjacent") return previousSibling(node, context) === anchor;
  return previousSiblings(node, context).includes(anchor);
};

function matchesPseudo(
  node: MarkdownNode,
  pseudo: Pseudo,
  context: SelectionContext,
): boolean {
  if (pseudo.kind === "first-child") {
    return siblingsOf(node, context)[0] === node;
  }
  if (pseudo.kind === "last-child") {
    return siblingsOf(node, context).at(-1) === node;
  }
  if (pseudo.kind === "nth-child") {
    return siblingsOf(node, context)[pseudo.index - 1] === node;
  }
  if (pseudo.kind === "contains") {
    return semanticText(node).includes(pseudo.value);
  }
  if (pseudo.kind === "matches") {
    return pseudo.pattern.test(semanticText(node));
  }
  if (pseudo.kind === "not") {
    return !pseudo.program.selectors.some((selector) =>
      matchesSequence(node, selector, context),
    );
  }
  return pseudo.program.selectors.some((selector) =>
    context.ordered.some((candidate) =>
      matchesSequence(candidate, selector, context, node),
    ),
  );
}

function matchesCompound(
  node: MarkdownNode,
  compound: CompoundSelector,
  context: SelectionContext,
): boolean {
  return (
    (compound.type === "*" || node.type === compound.type) &&
    compound.attributes.every((attribute) =>
      matchesAttribute(node, attribute),
    ) &&
    compound.pseudos.every((pseudo) => matchesPseudo(node, pseudo, context))
  );
}

function matchesSequence(
  node: MarkdownNode,
  steps: readonly SelectorStep[],
  context: SelectionContext,
  anchor?: MarkdownNode,
  stepIndex = steps.length - 1,
): boolean {
  const step = steps[stepIndex];
  if (step === undefined || !matchesCompound(node, step.compound, context)) {
    return false;
  }

  if (stepIndex === 0) {
    if (anchor === undefined) return step.combinator === undefined;
    return relatedToAnchor(
      node,
      anchor,
      step.combinator ?? "descendant",
      context,
    );
  }

  const combinator = step.combinator ?? "descendant";
  if (combinator === "child") {
    const parent = context.parents.get(node);
    return (
      parent !== undefined &&
      matchesSequence(parent, steps, context, anchor, stepIndex - 1)
    );
  }
  if (combinator === "adjacent") {
    const sibling = previousSibling(node, context);
    return (
      sibling !== undefined &&
      matchesSequence(sibling, steps, context, anchor, stepIndex - 1)
    );
  }
  if (combinator === "sibling") {
    return previousSiblings(node, context).some((sibling) =>
      matchesSequence(sibling, steps, context, anchor, stepIndex - 1),
    );
  }
  for (
    let ancestor = context.parents.get(node);
    ancestor !== undefined;
    ancestor = context.parents.get(ancestor)
  ) {
    if (matchesSequence(ancestor, steps, context, anchor, stepIndex - 1)) {
      return true;
    }
  }
  return false;
}

/** Selects matching derived nodes in source order without duplicate identities. */
export const select = (
  root: MarkdownNode,
  selector: CompiledSelector,
  options: SelectOptions = {},
): readonly MarkdownNode[] => {
  const program = programs.get(selector);
  if (program === undefined) {
    throw new TypeError("selector must be produced by compileSelector");
  }

  const parents = new Map<MarkdownNode, MarkdownNode>();
  const ordered: MarkdownNode[] = [];
  const visit = (node: MarkdownNode): void => {
    ordered.push(node);
    for (const child of childrenOf(node)) {
      parents.set(child, node);
      visit(child);
    }
  };
  visit(root);
  const context: SelectionContext = { ordered, parents };

  const candidates = options.includeRoot === false ? ordered.slice(1) : ordered;
  const matches = candidates.filter((node) =>
    program.selectors.some((steps) => matchesSequence(node, steps, context)),
  );
  return Object.freeze(matches);
};
