import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import {
  frontmatter,
  type Options as FrontmatterOptions,
} from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import type {
  Heading as MdastHeading,
  ListItem as MdastListItem,
  Paragraph as MdastParagraph,
  PhrasingContent as MdastPhrasingContent,
  RootContent as MdastRootContent,
} from "mdast";

import type { ConcreteDocument, ConcreteNode } from "./cst.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type {
  BlankLine,
  Block,
  Blockquote,
  BreakInline,
  CodeBlock,
  Definition,
  Document,
  Emphasis,
  FlowNode,
  Frontmatter,
  FrontmatterFormat,
  Heading,
  HeadingLevel,
  HtmlNode,
  Image,
  Inline,
  InlineCode,
  InlineContainer,
  Link,
  ListBlock,
  ListItem,
  OpaqueBlock,
  OpaqueInline,
  Paragraph,
  Section,
  Strong,
  Strikethrough,
  Table,
  TableAlignment,
  TableCell,
  TableRow,
  ThematicBreak,
} from "./model.ts";
import { success, type Result } from "./result.ts";
import {
  sourcePosition,
  sourceRange,
  type NewlineOccurrence,
  type NewlineStyle,
  type SourcePosition,
  type SourceRange,
  type SourceText,
} from "./source.ts";

export interface ParseOptions {
  readonly path?: string;
  readonly limits?: Partial<ParseLimits>;
}

export interface ParseLimits {
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxNestingDepth: number;
  readonly maxDiagnostics: number;
}

interface SourceIndex {
  readonly byteLength: number;
  readonly range: (start: number, end: number) => SourceRange;
}

interface SourceLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly content: string;
  readonly newline: NewlineStyle | undefined;
}

interface ParsedBlock {
  readonly concrete: ConcreteNode;
  readonly derived: Block | Heading;
}

interface CommonMarkContext {
  readonly source: string;
  readonly sourceOffset: number;
  readonly index: SourceIndex;
  readonly path?: string;
  readonly diagnostics: Diagnostic[];
  readonly maxDiagnostics: number;
}

interface InlineProgram {
  readonly nodes: readonly MdastPhrasingContent[];
  readonly context: CommonMarkContext;
}

interface SectionBuilder {
  readonly type: "section-builder";
  readonly heading: Heading;
  readonly body: Block[];
  readonly sections: SectionBuilder[];
  readonly children: (Heading | Block | SectionBuilder)[];
  end: SourcePosition;
}

interface DerivedSections {
  readonly preamble: readonly Block[];
  readonly children: readonly (Block | Section)[];
  readonly sections: readonly Section[];
}

interface PositionedNode {
  readonly position?:
    | {
        readonly start: { readonly offset?: number | undefined };
        readonly end: { readonly offset?: number | undefined };
      }
    | undefined;
}

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const frozenArray = <T>(values: readonly T[]): readonly T[] =>
  Object.freeze([...values]);

const defaultParseLimits: ParseLimits = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxNodes: 100_000,
  maxNestingDepth: 128,
  maxDiagnostics: 100,
});

const limitValue = (
  value: number | undefined,
  fallback: number,
  name: string,
  minimum = 0,
): number => {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return resolved;
};

const resolveParseLimits = (limits: Partial<ParseLimits> = {}): ParseLimits =>
  Object.freeze({
    maxBytes: limitValue(
      limits.maxBytes,
      defaultParseLimits.maxBytes,
      "maxBytes",
    ),
    maxNodes: limitValue(
      limits.maxNodes,
      defaultParseLimits.maxNodes,
      "maxNodes",
    ),
    maxNestingDepth: limitValue(
      limits.maxNestingDepth,
      defaultParseLimits.maxNestingDepth,
      "maxNestingDepth",
    ),
    maxDiagnostics: limitValue(
      limits.maxDiagnostics,
      defaultParseLimits.maxDiagnostics,
      "maxDiagnostics",
      1,
    ),
  });

const makeSourceIndex = (text: string): SourceIndex => {
  const positions: SourcePosition[] = [];
  let index = 0;
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;

  const setPosition = (at: number): void => {
    positions[at] = sourcePosition(byteOffset, line, column, utf16Column);
  };

  setPosition(0);

  if (text.startsWith("\uFEFF")) {
    byteOffset = 3;
    index = 1;
    setPosition(index);
  }

  while (index < text.length) {
    setPosition(index);

    if (text[index] === "\r" && text[index + 1] === "\n") {
      positions[index + 1] = sourcePosition(
        byteOffset + 1,
        line,
        column,
        utf16Column,
      );
      byteOffset += 2;
      index += 2;
      line += 1;
      column = 1;
      utf16Column = 1;
      setPosition(index);
      continue;
    }

    if (text[index] === "\r" || text[index] === "\n") {
      byteOffset += 1;
      index += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      setPosition(index);
      continue;
    }

    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;

    const width = codePoint > 0xffff ? 2 : 1;
    if (width === 2) {
      positions[index + 1] = sourcePosition(
        byteOffset,
        line,
        column,
        utf16Column + 1,
      );
    }
    byteOffset += utf8Width(codePoint);
    index += width;
    column += 1;
    utf16Column += width;
    setPosition(index);
  }

  const positionAt = (at: number): SourcePosition => {
    const position = positions[at];
    if (position === undefined) {
      throw new RangeError(`source index ${at} is not a character boundary`);
    }
    return position;
  };

  return {
    byteLength: byteOffset,
    range: (start, end) => sourceRange(positionAt(start), positionAt(end)),
  };
};

const splitLines = (text: string, contentStart: number): readonly SourceLine[] => {
  const lines: SourceLine[] = [];
  let start = contentStart;

  while (start < text.length) {
    let contentEnd = start;
    while (
      contentEnd < text.length &&
      text[contentEnd] !== "\r" &&
      text[contentEnd] !== "\n"
    ) {
      contentEnd += 1;
    }

    let newline: NewlineStyle | undefined;
    let end = contentEnd;
    if (text[contentEnd] === "\r" && text[contentEnd + 1] === "\n") {
      newline = "\r\n";
      end += 2;
    } else if (text[contentEnd] === "\r") {
      newline = "\r";
      end += 1;
    } else if (text[contentEnd] === "\n") {
      newline = "\n";
      end += 1;
    }

    lines.push({
      start,
      contentEnd,
      end,
      content: text.slice(start, contentEnd),
      newline,
    });
    start = end;
  }

  return frozenArray(lines);
};

const dominantNewline = (
  lines: readonly SourceLine[],
): NewlineStyle | undefined => {
  const counts = new Map<NewlineStyle, number>();
  const order: NewlineStyle[] = [];

  for (const { newline } of lines) {
    if (newline === undefined) continue;
    if (!counts.has(newline)) order.push(newline);
    counts.set(newline, (counts.get(newline) ?? 0) + 1);
  }

  let dominant: NewlineStyle | undefined;
  let highestCount = 0;
  for (const style of order) {
    const count = counts.get(style) ?? 0;
    if (count > highestCount) {
      dominant = style;
      highestCount = count;
    }
  }
  return dominant;
};

const makeSourceText = (
  text: string,
  lines: readonly SourceLine[],
  index: SourceIndex,
): SourceText => {
  const dominant = dominantNewline(lines);
  const mixedNewlines: NewlineOccurrence[] = [];

  for (const line of lines) {
    if (line.newline === undefined || line.newline === dominant) continue;
    mixedNewlines.push(
      Object.freeze({
        style: line.newline,
        range: index.range(line.contentEnd, line.end),
      }),
    );
  }

  return Object.freeze({
    text,
    byteLength: index.byteLength,
    ...(text.startsWith("\uFEFF") ? { bom: index.range(0, 1) } : {}),
    dominantNewline: dominant,
    mixedNewlines: frozenArray(mixedNewlines),
    hasFinalNewline: text.endsWith("\n") || text.endsWith("\r"),
  });
};

const concreteNode = <Kind extends ConcreteNode["kind"]>(
  kind: Kind,
  range: SourceRange,
  children: readonly ConcreteNode[] = [],
): ConcreteNode<Kind> =>
  Object.freeze({ kind, range, children: frozenArray(children) });

const isBlank = (content: string): boolean => /^[\t ]*$/u.test(content);

const inlinePrograms = new WeakMap<InlineContainer, InlineProgram>();
const inlineViews = new WeakMap<InlineContainer, readonly Inline[]>();

const frontmatterOptions: FrontmatterOptions = [
  "yaml",
  "toml",
  { type: "json", fence: { open: "{", close: "}" } },
];

const nodeOffsets = (
  node: PositionedNode,
  context: CommonMarkContext,
): readonly [number, number] => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new TypeError("CommonMark node must have source offsets");
  }
  return [start + context.sourceOffset, end + context.sourceOffset];
};

const extendThroughNewline = (source: string, end: number): number => {
  if (source[end] === "\r" && source[end + 1] === "\n") return end + 2;
  if (source[end] === "\r" || source[end] === "\n") return end + 1;
  return end;
};

const nodeRange = (
  node: PositionedNode,
  context: CommonMarkContext,
  trailingNewline = false,
): SourceRange => {
  const [start, rawEnd] = nodeOffsets(node, context);
  const end = trailingNewline
    ? extendThroughNewline(context.source, rawEnd)
    : rawEnd;
  return context.index.range(start, end);
};

const inlineRange = (
  nodes: readonly MdastPhrasingContent[],
  fallback: SourceRange,
  context: CommonMarkContext,
): SourceRange => {
  const first = nodes[0];
  const last = nodes.at(-1);
  if (first === undefined || last === undefined) {
    return sourceRange(fallback.end, fallback.end);
  }
  const [start] = nodeOffsets(first, context);
  const [, end] = nodeOffsets(last, context);
  return context.index.range(start, end);
};

const phrasingText = (nodes: readonly MdastPhrasingContent[]): string =>
  nodes
    .map((node): string => {
      if (node.type === "text" || node.type === "inlineCode") return node.value;
      if (node.type === "break") return "\n";
      if (node.type === "image" || node.type === "imageReference") {
        return node.alt ?? "";
      }
      if (node.type === "html") return node.value;
      if ("children" in node) {
        return phrasingText(node.children as readonly MdastPhrasingContent[]);
      }
      return "";
    })
    .join("");

const registerInlineProgram = <T extends InlineContainer>(
  container: T,
  nodes: readonly MdastPhrasingContent[],
  context: CommonMarkContext,
): T => {
  inlinePrograms.set(container, { nodes, context });
  return container;
};

const convertInline = (
  node: MdastPhrasingContent,
  context: CommonMarkContext,
): Inline => {
  const range = nodeRange(node, context);
  if (node.type === "text") {
    const concrete = concreteNode("text", range);
    return Object.freeze({ type: "text", range, concrete, value: node.value });
  }

  if (
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "delete"
  ) {
    const children = frozenArray(
      node.children.map((child) => convertInline(child, context)),
    );
    if (node.type === "emphasis") {
      const concrete = concreteNode(
        "emphasis",
        range,
        children.map((child) => child.concrete),
      );
      return Object.freeze({
        type: "emphasis",
        range,
        concrete,
        children,
      }) satisfies Emphasis;
    }
    if (node.type === "delete") {
      const concrete = concreteNode(
        "strikethrough",
        range,
        children.map((child) => child.concrete),
      );
      return Object.freeze({
        type: "strikethrough",
        range,
        concrete,
        children,
      }) satisfies Strikethrough;
    }
    const concrete = concreteNode(
      "strong",
      range,
      children.map((child) => child.concrete),
    );
    return Object.freeze({
      type: "strong",
      range,
      concrete,
      children,
    }) satisfies Strong;
  }

  if (node.type === "inlineCode") {
    const concrete = concreteNode("inline-code", range);
    return Object.freeze({
      type: "inline-code",
      range,
      concrete,
      value: node.value,
    }) satisfies InlineCode;
  }

  if (node.type === "break") {
    const concrete = concreteNode("break", range);
    return Object.freeze({
      type: "break",
      range,
      concrete,
    }) satisfies BreakInline;
  }

  if (node.type === "link" || node.type === "linkReference") {
    const children = frozenArray(
      node.children.map((child) => convertInline(child, context)),
    );
    const concrete = concreteNode(
      "link",
      range,
      children.map((child) => child.concrete),
    );
    return Object.freeze({
      type: "link",
      range,
      concrete,
      ...(node.type === "link"
        ? { destination: node.url }
        : { reference: node.identifier }),
      ...(node.type === "link" && node.title !== null && node.title !== undefined
        ? { title: node.title }
        : {}),
      children,
    }) satisfies Link;
  }

  if (node.type === "image" || node.type === "imageReference") {
    const concrete = concreteNode("image", range);
    return Object.freeze({
      type: "image",
      range,
      concrete,
      ...(node.type === "image"
        ? { destination: node.url }
        : { reference: node.identifier }),
      ...(node.type === "image" && node.title !== null && node.title !== undefined
        ? { title: node.title }
        : {}),
      alt: node.alt ?? "",
    }) satisfies Image;
  }

  if (node.type === "html") {
    const concrete = concreteNode("html-inline", range);
    return Object.freeze({
      type: "html",
      range,
      concrete,
      value: node.value,
    }) satisfies HtmlNode;
  }

  const concrete = concreteNode("opaque", range);
  return Object.freeze({
    type: "opaque",
    range,
    concrete,
    reason: `unsupported-inline-${node.type}`,
  }) satisfies OpaqueInline;
};

/** Materializes and caches a block's immutable semantic inline view. */
export const inlines = (container: InlineContainer): readonly Inline[] => {
  const existing = inlineViews.get(container);
  if (existing !== undefined) return existing;
  const program = inlinePrograms.get(container);
  if (program === undefined) {
    throw new TypeError("inline container must be produced by parse");
  }
  const view = frozenArray(
    program.nodes.map((node) => convertInline(node, program.context)),
  );
  inlineViews.set(container, view);
  return view;
};

const headingStyle = (
  node: MdastHeading,
  context: CommonMarkContext,
): "atx" | "setext" => {
  const [start] = nodeOffsets(node, context);
  return /^ {0,3}#{1,6}(?:[\t ]|$)/u.test(context.source.slice(start))
    ? "atx"
    : "setext";
};

const convertHeading = (
  node: MdastHeading,
  context: CommonMarkContext,
  range: SourceRange,
): Heading => {
  const style = headingStyle(node, context);
  const concrete = concreteNode(
    style === "atx" ? "atx-heading" : "setext-heading",
    range,
  );
  return registerInlineProgram(
    Object.freeze({
      type: "heading",
      range,
      concrete,
      level: node.depth as HeadingLevel,
      title: phrasingText(node.children),
      style,
      inlineRange: inlineRange(node.children, range, context),
    }),
    node.children,
    context,
  );
};

const convertParagraph = (
  node: MdastParagraph,
  context: CommonMarkContext,
  range: SourceRange,
): Paragraph => {
  const concrete = concreteNode("paragraph", range);
  return registerInlineProgram(
    Object.freeze({
      type: "paragraph",
      range,
      concrete,
      inlineRange: inlineRange(node.children, range, context),
      text: phrasingText(node.children),
    }),
    node.children,
    context,
  );
};

const convertFrontmatter = (
  node: MdastRootContent & {
    readonly type: FrontmatterFormat;
    readonly value: string;
  },
  range: SourceRange,
): Frontmatter => {
  const concrete = concreteNode("frontmatter", range);
  return Object.freeze({
    type: "frontmatter",
    range,
    concrete,
    format: node.type,
    value: node.value,
  });
};

const convertDefinition = (
  node: MdastRootContent & { readonly type: "definition" },
  range: SourceRange,
): Definition => {
  const concrete = concreteNode("definition", range);
  return Object.freeze({
    type: "definition",
    range,
    concrete,
    reference: node.identifier,
    ...(node.label === null || node.label === undefined
      ? {}
      : { label: node.label }),
    destination: node.url,
    ...(node.title === null || node.title === undefined
      ? {}
      : { title: node.title }),
  });
};

const pushDiagnostic = (
  context: CommonMarkContext,
  diagnostic: Diagnostic,
): void => {
  if (context.diagnostics.length < context.maxDiagnostics) {
    context.diagnostics.push(Object.freeze(diagnostic));
    return;
  }
  const last = context.diagnostics.at(-1);
  if (last?.code === "markdown.diagnostic-limit") return;
  context.diagnostics[context.maxDiagnostics - 1] = Object.freeze({
    code: "markdown.diagnostic-limit",
    severity: "warning",
    message: `Stopped reporting Markdown diagnostics after ${context.maxDiagnostics} entries.`,
    source: "markdown",
    ...(context.path === undefined ? {} : { path: context.path }),
    range: context.index.range(context.sourceOffset, context.source.length),
  });
};

const opaqueBlock = (
  node: MdastRootContent,
  context: CommonMarkContext,
  range: SourceRange,
): OpaqueBlock => {
  const concrete = concreteNode("opaque", range);
  const reason = `unsupported-block-${node.type}`;
  pushDiagnostic(context, {
    code: "markdown.opaque-block",
    severity: "warning",
    message: "Preserved an unsupported Markdown block as opaque source.",
    source: "markdown",
    ...(context.path === undefined ? {} : { path: context.path }),
    range,
  });
  return Object.freeze({ type: "opaque", range, concrete, reason });
};

const convertListItem = (
  node: MdastListItem,
  context: CommonMarkContext,
): ListItem => {
  const range = nodeRange(node, context);
  const children = frozenArray(
    node.children.map((child) =>
      convertFlow(child, context, nodeRange(child, context)),
    ),
  );
  const concrete = concreteNode(
    "item",
    range,
    children.map((child) => child.concrete),
  );
  return Object.freeze({
    type: "item",
    range,
    concrete,
    ...(node.checked === null || node.checked === undefined
      ? {}
      : { checked: node.checked }),
    children,
  });
};

const convertTableCell = (
  node: MdastRootContent & { readonly type: "tableCell" },
  context: CommonMarkContext,
  alignment: TableAlignment,
  header: boolean,
): TableCell => {
  const range = nodeRange(node, context);
  const concrete = concreteNode("cell", range);
  return registerInlineProgram(
    Object.freeze({
      type: "cell",
      range,
      concrete,
      alignment,
      header,
      inlineRange: inlineRange(node.children, range, context),
      text: phrasingText(node.children),
    }),
    node.children,
    context,
  );
};

const convertFlow = (
  node: MdastRootContent,
  context: CommonMarkContext,
  range: SourceRange,
): FlowNode => {
  if (node.type === "heading") return convertHeading(node, context, range);
  if (node.type === "paragraph") return convertParagraph(node, context, range);
  if (node.type === "yaml" || node.type === "toml" || node.type === "json") {
    return convertFrontmatter(node, range);
  }
  if (node.type === "definition") return convertDefinition(node, range);

  if (node.type === "blockquote") {
    const children = frozenArray(
      node.children.map((child) =>
        convertFlow(child, context, nodeRange(child, context)),
      ),
    );
    const concrete = concreteNode(
      "blockquote",
      range,
      children.map((child) => child.concrete),
    );
    return Object.freeze({
      type: "blockquote",
      range,
      concrete,
      children,
    }) satisfies Blockquote;
  }

  if (node.type === "list") {
    const children = frozenArray(
      node.children.map((child) => convertListItem(child, context)),
    );
    const concrete = concreteNode(
      "list",
      range,
      children.map((child) => child.concrete),
    );
    return Object.freeze({
      type: "list",
      range,
      concrete,
      ordered: node.ordered === true,
      start: node.start ?? undefined,
      tight: node.spread !== true,
      children,
    }) satisfies ListBlock;
  }

  if (node.type === "code") {
    const [start] = nodeOffsets(node, context);
    const fenced = /^ {0,3}(?:`{3,}|~{3,})/u.test(
      context.source.slice(start),
    );
    const concrete = concreteNode(
      fenced ? "fenced-code" : "indented-code",
      range,
    );
    return Object.freeze({
      type: "code",
      range,
      concrete,
      ...(node.lang === null || node.lang === undefined
        ? {}
        : { language: node.lang }),
      ...(node.meta === null || node.meta === undefined
        ? {}
        : { meta: node.meta }),
      fenced,
      value: node.value,
    }) satisfies CodeBlock;
  }

  if (node.type === "html") {
    const concrete = concreteNode("html", range);
    return Object.freeze({
      type: "html",
      range,
      concrete,
      value: node.value,
    }) satisfies HtmlNode;
  }

  if (node.type === "thematicBreak") {
    const concrete = concreteNode("thematic-break", range);
    return Object.freeze({
      type: "thematic-break",
      range,
      concrete,
    }) satisfies ThematicBreak;
  }

  if (node.type === "table") {
    const alignments = frozenArray(
      (node.align ?? []).map((alignment) => alignment ?? undefined),
    );
    const children = frozenArray(
      node.children.map((row, rowIndex): TableRow => {
        const rowRange = nodeRange(row, context);
        const cells = frozenArray(
          row.children.map((cell, cellIndex) =>
            convertTableCell(
              cell,
              context,
              alignments[cellIndex],
              rowIndex === 0,
            ),
          ),
        );
        const rowConcrete = concreteNode(
          "row",
          rowRange,
          cells.map((cell) => cell.concrete),
        );
        return Object.freeze({
          type: "row",
          range: rowRange,
          concrete: rowConcrete,
          header: rowIndex === 0,
          children: cells,
        });
      }),
    );
    const concrete = concreteNode(
      "table",
      range,
      children.map((row) => row.concrete),
    );
    return Object.freeze({
      type: "table",
      range,
      concrete,
      alignments,
      children,
    }) satisfies Table;
  }

  return opaqueBlock(node, context, range);
};

const blankLine = (line: SourceLine, index: SourceIndex): ParsedBlock => {
  const range = index.range(line.start, line.end);
  const concrete = concreteNode("blank-line", range);
  const derived: BlankLine = Object.freeze({
    type: "blank-line",
    range,
    concrete,
  });
  return Object.freeze({ concrete, derived });
};

const limitedBlock = (
  context: CommonMarkContext,
  start: number,
  end: number,
  reason: string,
  message: string,
): ParsedBlock => {
  const range = context.index.range(start, end);
  const concrete = concreteNode("opaque", range);
  const derived: OpaqueBlock = Object.freeze({
    type: "opaque",
    range,
    concrete,
    reason,
  });
  pushDiagnostic(context, {
    code: "markdown.limit",
    severity: "warning",
    message,
    source: "markdown",
    ...(context.path === undefined ? {} : { path: context.path }),
    range,
  });
  return Object.freeze({ concrete, derived });
};

const subtreeSizeAndDepth = (
  root: MdastRootContent,
): { readonly nodes: number; readonly depth: number } => {
  const stack: { readonly node: object; readonly depth: number }[] = [
    { node: root, depth: 1 },
  ];
  let nodes = 0;
  let depth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    depth = Math.max(depth, current.depth);
    if (!("children" in current.node) || !Array.isArray(current.node.children)) {
      continue;
    }
    for (const child of current.node.children) {
      if (typeof child === "object" && child !== null) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  return { nodes, depth };
};

const parseBlocks = (
  source: string,
  contentStart: number,
  lines: readonly SourceLine[],
  index: SourceIndex,
  path: string | undefined,
  limits: ParseLimits,
): {
  readonly blocks: readonly ParsedBlock[];
  readonly diagnostics: readonly Diagnostic[];
} => {
  const diagnostics: Diagnostic[] = [];
  const context: CommonMarkContext = {
    source,
    sourceOffset: contentStart,
    index,
    ...(path === undefined ? {} : { path }),
    diagnostics,
    maxDiagnostics: limits.maxDiagnostics,
  };

  if (index.byteLength > limits.maxBytes) {
    const limited = limitedBlock(
      context,
      contentStart,
      source.length,
      "limit-max-bytes",
      `Stopped semantic Markdown parsing after exceeding ${limits.maxBytes} UTF-8 bytes.`,
    );
    const blocks = contentStart >= source.length ? [] : [limited];
    return {
      blocks: frozenArray(blocks),
      diagnostics: frozenArray(diagnostics),
    };
  }

  const tree = fromMarkdown(source.slice(contentStart), {
    extensions: [frontmatter(frontmatterOptions), gfm()],
    mdastExtensions: [
      frontmatterFromMarkdown(frontmatterOptions),
      gfmFromMarkdown(),
    ],
  });
  const spans: {
    readonly start: number;
    readonly end: number;
    readonly parsed: ParsedBlock;
  }[] = [];
  let usedNodes = 0;
  for (const node of tree.children) {
    const [rawStart, rawEnd] = nodeOffsets(node, context);
    const startLine = node.position?.start.line;
    const start =
      startLine === undefined ? rawStart : (lines[startLine - 1]?.start ?? rawStart);
    const end = extendThroughNewline(source, rawEnd);
    const stats = subtreeSizeAndDepth(node);
    if (usedNodes + stats.nodes > limits.maxNodes) {
      spans.push({
        start,
        end: source.length,
        parsed: limitedBlock(
          context,
          start,
          source.length,
          "limit-max-nodes",
          `Stopped semantic Markdown parsing after ${limits.maxNodes} syntax nodes.`,
        ),
      });
      break;
    }
    const range = index.range(start, end);
    usedNodes += stats.nodes;
    const derived =
      stats.depth > limits.maxNestingDepth
        ? limitedBlock(
            context,
            start,
            end,
            "limit-max-nesting-depth",
            `Preserved a Markdown block exceeding nesting depth ${limits.maxNestingDepth} as opaque source.`,
          ).derived
        : convertFlow(node, context, range);
    const parsed: ParsedBlock = Object.freeze({
      concrete: derived.concrete,
      derived,
    });
    spans.push({ start, end, parsed });
  }
  const blocks = spans.map(({ parsed }) => parsed);

  for (const line of lines) {
    if (!isBlank(line.content)) continue;
    const covered = spans.some(
      ({ start, end }) => line.start >= start && line.end <= end,
    );
    if (!covered) blocks.push(blankLine(line, index));
  }

  blocks.sort(
    (left, right) =>
      left.derived.range.start.byteOffset -
      right.derived.range.start.byteOffset,
  );
  return {
    blocks: frozenArray(blocks),
    diagnostics: frozenArray(diagnostics),
  };
};

const sectionBuilder = (
  heading: Heading,
  end: SourcePosition,
): SectionBuilder => ({
  type: "section-builder",
  heading,
  body: [],
  sections: [],
  children: [heading],
  end,
});

const freezeSection = (builder: SectionBuilder): Section => {
  const sections = builder.sections.map(freezeSection);
  const sectionByBuilder = new Map(
    builder.sections.map((child, index) => [child, sections[index]!] as const),
  );
  const children = builder.children.map((child) =>
    child.type === "section-builder" ? sectionByBuilder.get(child)! : child,
  );

  return Object.freeze({
    type: "section",
    range: sourceRange(builder.heading.range.start, builder.end),
    level: builder.heading.level,
    heading: builder.heading,
    title: builder.heading.title,
    body: frozenArray(builder.body),
    sections: frozenArray(sections),
    children: frozenArray(children),
  });
};

const deriveSections = (
  blocks: readonly ParsedBlock[],
  documentEnd: SourcePosition,
): DerivedSections => {
  const preamble: Block[] = [];
  const rootChildren: (Block | SectionBuilder)[] = [];
  const rootSections: SectionBuilder[] = [];
  const stack: SectionBuilder[] = [];

  for (const { derived } of blocks) {
    if (derived.type !== "heading") {
      const parent = stack.at(-1);
      if (parent === undefined) {
        preamble.push(derived);
        rootChildren.push(derived);
      } else {
        parent.body.push(derived);
        parent.children.push(derived);
      }
      continue;
    }

    while (
      stack.length > 0 &&
      stack.at(-1)!.heading.level >= derived.level
    ) {
      stack.pop()!.end = derived.range.start;
    }

    const builder = sectionBuilder(derived, documentEnd);
    const parent = stack.at(-1);
    if (parent === undefined) {
      rootSections.push(builder);
      rootChildren.push(builder);
    } else {
      parent.sections.push(builder);
      parent.children.push(builder);
    }
    stack.push(builder);
  }

  for (const open of stack) open.end = documentEnd;

  const sections = rootSections.map(freezeSection);
  const sectionByBuilder = new Map(
    rootSections.map((builder, index) => [builder, sections[index]!] as const),
  );
  const children = rootChildren.map((child) =>
    child.type === "section-builder" ? sectionByBuilder.get(child)! : child,
  );

  return {
    preamble: frozenArray(preamble),
    children: frozenArray(children),
    sections: frozenArray(sections),
  };
};

export const parse = (
  source: string,
  options: ParseOptions = {},
): Result<Document> => {
  const limits = resolveParseLimits(options.limits);
  const index = makeSourceIndex(source);
  const contentStart = source.startsWith("\uFEFF") ? 1 : 0;
  const lines = splitLines(source, contentStart);
  const sourceText = makeSourceText(source, lines, index);
  const parsed = parseBlocks(
    source,
    contentStart,
    lines,
    index,
    options.path,
    limits,
  );
  const documentRange = index.range(0, source.length);
  const concreteChildren: ConcreteNode[] = [];

  if (sourceText.bom !== undefined) {
    concreteChildren.push(concreteNode("bom", sourceText.bom));
  }
  concreteChildren.push(...parsed.blocks.map(({ concrete }) => concrete));

  const cst: ConcreteDocument = Object.freeze({
    kind: "document",
    range: documentRange,
    children: frozenArray(concreteChildren),
  });

  const derived = deriveSections(parsed.blocks, documentRange.end);

  const document: Document = Object.freeze({
    type: "document",
    source: sourceText,
    ...(options.path === undefined ? {} : { path: options.path }),
    range: documentRange,
    diagnostics: parsed.diagnostics,
    cst,
    preamble: derived.preamble,
    children: derived.children,
    sections: derived.sections,
  });

  return success(document, parsed.diagnostics);
};
