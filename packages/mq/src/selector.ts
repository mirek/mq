import {
  first,
  map,
  parse as parseWith,
  regexp,
  seq,
  star,
} from "@prelude/parser";

import type { Diagnostic } from "./diagnostic.ts";
import type { MarkdownNode } from "./model.ts";
import { failure, success, type Result } from "./result.ts";
import { sourcePosition, sourceRange } from "./source.ts";

type AttributeValue = string | number | boolean;
type Combinator = "child" | "descendant";

interface RawAttributeSelector {
  readonly name: string;
  readonly rawValue: string;
}

interface RawCompoundSelector {
  readonly type: string;
  readonly attributes: readonly RawAttributeSelector[];
}

interface RawSelectorStep {
  readonly combinator?: Combinator;
  readonly compound: RawCompoundSelector;
}

interface AttributeSelector {
  readonly name: string;
  readonly value: AttributeValue;
}

interface CompoundSelector {
  readonly type: string;
  readonly attributes: readonly AttributeSelector[];
}

interface SelectorStep {
  readonly combinator?: Combinator;
  readonly compound: CompoundSelector;
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

const whitespace0 = regexp(/\s*/u);
const whitespace1 = regexp(/\s+/u);
const identifier = regexp(/[A-Za-z][A-Za-z0-9-]*/u);
const universal = regexp(/\*/u);
const quotedValue = first(
  regexp(/"(?:\\.|[^"\\])*"/su),
  regexp(/'(?:\\.|[^'\\])*'/su),
);
const unquotedValue = regexp(/[^\s\]]+/u);

const attributeParser = map(
  seq(
    "[",
    whitespace0,
    identifier,
    whitespace0,
    "=",
    whitespace0,
    first(quotedValue, unquotedValue),
    whitespace0,
    "]",
  ),
  (parts): RawAttributeSelector => ({
    name: parts[2],
    rawValue: parts[6],
  }),
);

const compoundParser = map(
  seq(first(universal, identifier), star(attributeParser)),
  (parts): RawCompoundSelector => ({
    type: parts[0],
    attributes: parts[1],
  }),
);

const childStepParser = map(
  seq(whitespace0, ">", whitespace0, compoundParser),
  (parts): RawSelectorStep => ({
    combinator: "child",
    compound: parts[3],
  }),
);

const descendantStepParser = map(
  seq(whitespace1, compoundParser),
  (parts): RawSelectorStep => ({
    combinator: "descendant",
    compound: parts[1],
  }),
);

const selectorParser = map(
  seq(
    whitespace0,
    compoundParser,
    star(first(childStepParser, descendantStepParser)),
    whitespace0,
  ),
  (parts): readonly RawSelectorStep[] => [
    { compound: parts[1] },
    ...parts[2],
  ],
);

class SelectorTypeError extends Error {}

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
    sourcePosition(
      byteOffset,
      line,
      column,
      utf16Column,
    ),
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

const programs = new WeakMap<CompiledSelector, readonly SelectorStep[]>();

/** Compiles the lossless-sections selector subset without throwing on user input. */
export const compileSelector = (
  source: string,
): Result<CompiledSelector> => {
  try {
    const rawSteps = parseWith(selectorParser, source);
    const steps = rawSteps.map(({ combinator, compound }) => {
      const type = compound.type.toLowerCase();
      return Object.freeze({
        ...(combinator === undefined ? {} : { combinator }),
        compound: Object.freeze({
          type,
          attributes: Object.freeze(
            compound.attributes.map(({ name, rawValue }) => {
              const normalizedName = name.toLowerCase();
              return Object.freeze({
                name: normalizedName,
                value: decodeAttributeValue(normalizedName, rawValue),
              });
            }),
          ),
        }),
      });
    });

    const compiled = Object.freeze({ source });
    programs.set(compiled, Object.freeze(steps));
    return success(compiled);
  } catch (error) {
    const isTypeError = error instanceof SelectorTypeError;
    return failure(
      diagnostic(
        source,
        isTypeError ? "selector.attribute-type" : "selector.syntax",
        isTypeError
          ? error.message
          : "The selector does not match the supported core syntax.",
      ),
    );
  }
};

const childrenOf = (node: MarkdownNode): readonly MarkdownNode[] => {
  if (node.type === "document" || node.type === "section") {
    return node.children;
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
  if (name === "reason" && node.type === "opaque") return node.reason;
  if (name === "value" && node.type === "text") return node.value;
  return undefined;
};

const matchesCompound = (
  node: MarkdownNode,
  compound: CompoundSelector,
): boolean =>
  (compound.type === "*" || node.type === compound.type) &&
  compound.attributes.every(
    ({ name, value }) => attributeOf(node, name) === value,
  );

const matchesStep = (
  node: MarkdownNode,
  stepIndex: number,
  steps: readonly SelectorStep[],
  parents: ReadonlyMap<MarkdownNode, MarkdownNode>,
): boolean => {
  if (!matchesCompound(node, steps[stepIndex]!.compound)) return false;
  if (stepIndex === 0) return true;

  const combinator = steps[stepIndex]!.combinator;
  const parent = parents.get(node);
  if (combinator === "child") {
    return (
      parent !== undefined &&
      matchesStep(parent, stepIndex - 1, steps, parents)
    );
  }

  for (let ancestor = parent; ancestor !== undefined; ancestor = parents.get(ancestor)) {
    if (matchesStep(ancestor, stepIndex - 1, steps, parents)) return true;
  }
  return false;
};

/** Selects matching derived nodes in source order without duplicate identities. */
export const select = (
  root: MarkdownNode,
  selector: CompiledSelector,
  options: SelectOptions = {},
): readonly MarkdownNode[] => {
  const steps = programs.get(selector);
  if (steps === undefined) {
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

  const seen = new Set<MarkdownNode>();
  const matches: MarkdownNode[] = [];
  const candidates = options.includeRoot === false ? ordered.slice(1) : ordered;
  for (const node of candidates) {
    if (
      !seen.has(node) &&
      matchesStep(node, steps.length - 1, steps, parents)
    ) {
      seen.add(node);
      matches.push(node);
    }
  }
  return Object.freeze(matches);
};
