import {
  Reader,
  Result as ParserResult,
  regexp,
  type Parser,
} from "@prelude/parser";

import type { Diagnostic } from "./diagnostic.ts";
import type { Document, MarkdownNode } from "./model.ts";
import { failure, success, type Result } from "./result.ts";
import { compileSelector, select, type CompiledSelector } from "./selector.ts";
import {
  sourcePosition,
  sourceRange,
  type SourcePosition,
  type SourceRange,
} from "./source.ts";

type ExpressionStageKind =
  | "identity"
  | "markdown"
  | "text"
  | "json"
  | "count"
  | "first"
  | "last"
  | "array";

interface ExpressionStage {
  readonly kind: ExpressionStageKind;
}

interface SelectStage {
  readonly kind: "select";
  readonly selector: CompiledSelector;
}

type CompiledStage = ExpressionStage | SelectStage;

/** An immutable, reusable expression program produced by {@link compileExpression}. */
export interface CompiledExpression {
  readonly source: string;
}

export type QueryJsonPrimitive = string | number | boolean | null;

export interface QueryJsonObject {
  readonly [key: string]: QueryJsonValue;
}

export type QueryJsonValue =
  | QueryJsonPrimitive
  | readonly QueryJsonValue[]
  | QueryJsonObject;

/** A value emitted by an evaluated query expression. */
export type QueryValue =
  | MarkdownNode
  | QueryJsonPrimitive
  | QueryJsonObject
  | readonly QueryValue[];

interface ParseState {
  readonly source: string;
  offset: number;
}

interface ParsedToken<T> {
  readonly value: T;
  readonly start: number;
  readonly end: number;
}

const whitespace = regexp(/\s*/u);
const identifier = regexp(/[A-Za-z][A-Za-z0-9]*/u);
const jsonString = regexp(
  /"(?:\\(?:["\\/bfnrt]|u[\dA-Fa-f]{4})|[^"\\])*"/u,
);

const stageKinds = new Map<string, ExpressionStageKind>([
  ["markdown", "markdown"],
  ["text", "text"],
  ["json", "json"],
  ["count", "count"],
  ["first", "first"],
  ["last", "last"],
  ["array", "array"],
]);

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const positionAt = (source: string, target: number): SourcePosition => {
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;

  for (let index = 0; index < target; ) {
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
    byteOffset += utf8Width(codePoint);
    column += 1;
    utf16Column += width;
  }

  return sourcePosition(byteOffset, line, column, utf16Column);
};

const rangeAt = (source: string, start: number, end: number): SourceRange =>
  sourceRange(positionAt(source, start), positionAt(source, end));

const nextCodePointEnd = (source: string, start: number): number => {
  const codePoint = source.codePointAt(start);
  if (codePoint === undefined) return start;
  return start + (codePoint > 0xffff ? 2 : 1);
};

const unexpectedEnd = (source: string, start: number): number => {
  if (start >= source.length) return start;

  let end = start;
  while (end < source.length && !/[\s|()]/u.test(source[end]!)) {
    end = nextCodePointEnd(source, end);
  }
  return end === start ? nextCodePointEnd(source, start) : end;
};

class ExpressionCompileError extends Error {
  readonly code: string;
  readonly start: number;
  readonly end: number;

  constructor(message: string, start: number, end: number, code = "expression.syntax") {
    super(message);
    this.code = code;
    this.start = start;
    this.end = end;
  }
}

const parseToken = <T>(
  parser: Parser<T>,
  state: ParseState,
  message: string,
): ParsedToken<T> => {
  const start = state.offset;
  const result = parser(Reader.of(state.source, start));
  if (ParserResult.failed(result)) {
    throw new ExpressionCompileError(
      message,
      start,
      unexpectedEnd(state.source, start),
    );
  }
  state.offset = result.reader.offset;
  return { value: result.value, start, end: state.offset };
};

const skipWhitespace = (state: ParseState): void => {
  parseToken(whitespace, state, "Expected whitespace.");
};

const expectLiteral = (
  state: ParseState,
  literal: string,
  message: string,
): void => {
  if (!state.source.startsWith(literal, state.offset)) {
    throw new ExpressionCompileError(
      message,
      state.offset,
      unexpectedEnd(state.source, state.offset),
    );
  }
  state.offset += literal.length;
};

const parseSelect = (state: ParseState): SelectStage => {
  skipWhitespace(state);
  expectLiteral(state, "(", 'Expected "(" after select.');
  skipWhitespace(state);

  const string = parseToken(
    jsonString,
    state,
    "Expected a JSON string containing a selector.",
  );
  let selectorSource: string;
  try {
    selectorSource = JSON.parse(string.value) as string;
  } catch {
    throw new ExpressionCompileError(
      "Selector argument must be a valid JSON string.",
      string.start,
      string.end,
    );
  }
  const selector = compileSelector(selectorSource);
  if (!selector.ok) {
    const nested = selector.diagnostics[0];
    throw new ExpressionCompileError(
      nested.message,
      string.start,
      string.end,
      nested.code,
    );
  }

  skipWhitespace(state);
  expectLiteral(state, ")", 'Expected ")" after select argument.');
  return Object.freeze({ kind: "select", selector: selector.value });
};

const parseStage = (state: ParseState): CompiledStage => {
  if (state.source[state.offset] === ".") {
    state.offset += 1;
    return Object.freeze({ kind: "identity" });
  }

  const name = parseToken(
    identifier,
    state,
    "Expected an expression stage.",
  );
  if (name.value === "select") return parseSelect(state);

  const kind = stageKinds.get(name.value);
  if (kind === undefined) {
    throw new ExpressionCompileError(
      `Unknown expression stage ${JSON.stringify(name.value)}.`,
      name.start,
      name.end,
    );
  }
  return Object.freeze({ kind });
};

const parseExpression = (source: string): readonly CompiledStage[] => {
  const state: ParseState = { source, offset: 0 };
  const stages: CompiledStage[] = [];
  skipWhitespace(state);
  stages.push(parseStage(state));
  skipWhitespace(state);

  while (state.offset < source.length) {
    if (source[state.offset] !== "|") {
      throw new ExpressionCompileError(
        "Unexpected input after expression stage.",
        state.offset,
        unexpectedEnd(source, state.offset),
      );
    }
    state.offset += 1;
    skipWhitespace(state);
    stages.push(parseStage(state));
    skipWhitespace(state);
  }

  return Object.freeze(stages);
};

const diagnostic = (source: string, error: ExpressionCompileError): Diagnostic =>
  Object.freeze({
    code: error.code,
    severity: "error",
    message: error.message,
    source: "expression",
    range: rangeAt(source, error.start, error.end),
  });

const programs = new WeakMap<CompiledExpression, readonly CompiledStage[]>();

/** Compiles an expression pipeline without throwing on ordinary user input. */
export const compileExpression = (
  source: string,
): Result<CompiledExpression> => {
  try {
    const stages = parseExpression(source);
    const compiled = Object.freeze({ source });
    programs.set(compiled, stages);
    return success(compiled);
  } catch (error) {
    if (!(error instanceof ExpressionCompileError)) throw error;
    return failure(diagnostic(source, error));
  }
};

interface EvaluationContext {
  readonly document: Document;
  readonly utf16IndexByByteOffset: ReadonlyMap<number, number>;
}

const makeEvaluationContext = (document: Document): EvaluationContext => {
  const utf16IndexByByteOffset = new Map<number, number>();
  let byteOffset = 0;
  let index = 0;
  utf16IndexByByteOffset.set(byteOffset, index);

  while (index < document.source.text.length) {
    const codePoint = document.source.text.codePointAt(index);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    byteOffset += utf8Width(codePoint);
    index += width;
    utf16IndexByByteOffset.set(byteOffset, index);
  }

  return { document, utf16IndexByByteOffset };
};

const isMarkdownNode = (value: QueryValue): value is MarkdownNode =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "range" in value &&
  "type" in value;

const markdownOf = (
  node: MarkdownNode,
  context: EvaluationContext,
): string => {
  const start = context.utf16IndexByByteOffset.get(node.range.start.byteOffset);
  const end = context.utf16IndexByByteOffset.get(node.range.end.byteOffset);
  if (start === undefined || end === undefined) {
    throw new TypeError("node range must belong to the evaluated document");
  }
  return context.document.source.text.slice(start, end);
};

const withoutFinalNewline = (value: string): string =>
  value.replace(/(?:\r\n|\r|\n)$/u, "").replace(/\r\n?|\n/gu, "\n");

const textOf = (node: MarkdownNode, context: EvaluationContext): string => {
  if (node.type === "heading") return node.title;
  if (node.type === "text") return node.value;
  if (node.type === "document" || node.type === "section") {
    return node.children.map((child) => textOf(child, context)).join("\n");
  }
  if (node.type === "blank-line") return "";
  return withoutFinalNewline(markdownOf(node, context));
};

const canonicalObject = (
  entries: readonly (readonly [string, QueryJsonValue])[],
): QueryJsonObject => {
  const sorted = entries.toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return Object.freeze(Object.fromEntries(sorted)) as QueryJsonObject;
};

const nodeToJson = (
  node: MarkdownNode,
  context: EvaluationContext,
): QueryJsonObject => {
  if (node.type === "document") {
    return canonicalObject([
      ["children", Object.freeze(node.children.map((child) => nodeToJson(child, context)))],
      ...(node.path === undefined ? [] : [["path", node.path] as const]),
      ["type", node.type],
    ]);
  }
  if (node.type === "section") {
    return canonicalObject([
      ["children", Object.freeze(node.children.map((child) => nodeToJson(child, context)))],
      ["level", node.level],
      ["title", node.title],
      ["type", node.type],
    ]);
  }
  if (node.type === "heading") {
    return canonicalObject([
      ["level", node.level],
      ["style", node.style],
      ["title", node.title],
      ["type", node.type],
    ]);
  }
  if (node.type === "paragraph") {
    return canonicalObject([
      ["text", textOf(node, context)],
      ["type", node.type],
    ]);
  }
  if (node.type === "blank-line") {
    return canonicalObject([["type", node.type]]);
  }
  if (node.type === "text") {
    return canonicalObject([
      ["type", node.type],
      ["value", node.value],
    ]);
  }
  return canonicalObject([
    ["markdown", markdownOf(node, context)],
    ["reason", node.reason],
    ["type", node.type],
  ]);
};

const valueToJson = (
  value: QueryValue,
  context: EvaluationContext,
): QueryJsonValue => {
  if (isMarkdownNode(value)) return nodeToJson(value, context);
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => valueToJson(item, context)));
  }
  if (typeof value === "object" && value !== null) {
    return canonicalObject(
      Object.entries(value).map(([key, item]) => [key, valueToJson(item, context)]),
    );
  }
  return value;
};

const evaluateStage = (
  incoming: readonly QueryValue[],
  stage: CompiledStage,
  context: EvaluationContext,
): readonly QueryValue[] => {
  if (stage.kind === "identity") return incoming;
  if (stage.kind === "count") return Object.freeze([incoming.length]);
  if (stage.kind === "first") {
    return incoming.length === 0 ? Object.freeze([]) : Object.freeze([incoming[0]!]);
  }
  if (stage.kind === "last") {
    return incoming.length === 0 ? Object.freeze([]) : Object.freeze([incoming.at(-1)!]);
  }
  if (stage.kind === "array") {
    return Object.freeze([Object.freeze([...incoming])]);
  }

  const outgoing: QueryValue[] = [];
  for (const value of incoming) {
    if (stage.kind === "json") {
      outgoing.push(valueToJson(value, context));
    } else if (isMarkdownNode(value)) {
      if (stage.kind === "select") {
        outgoing.push(...select(value, stage.selector));
      } else if (stage.kind === "markdown") {
        outgoing.push(markdownOf(value, context));
      } else if (stage.kind === "text") {
        outgoing.push(textOf(value, context));
      }
    }
  }
  return Object.freeze(outgoing);
};

/** Evaluates a compiled expression as an immutable ordered value stream. */
export const evaluate = (
  document: Document,
  expression: CompiledExpression,
): readonly QueryValue[] => {
  const stages = programs.get(expression);
  if (stages === undefined) {
    throw new TypeError("expression must be produced by compileExpression");
  }

  const context = makeEvaluationContext(document);
  let stream: readonly QueryValue[] = Object.freeze([document]);
  for (const stage of stages) stream = evaluateStage(stream, stage, context);
  return stream;
};
