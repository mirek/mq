import type { ConcreteDocument, ConcreteNode } from "./cst.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type {
  BlankLine,
  Block,
  Document,
  Heading,
  HeadingLevel,
  OpaqueBlock,
  Paragraph,
  Section,
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

interface AtxHeadingMatch {
  readonly level: HeadingLevel;
  readonly title: string;
}

interface SetextHeadingMatch {
  readonly level: 1 | 2;
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

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const frozenArray = <T>(values: readonly T[]): readonly T[] =>
  Object.freeze([...values]);

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
    hasFinalNewline:
      text.endsWith("\n") || text.endsWith("\r"),
  });
};

const concreteNode = <Kind extends ConcreteNode["kind"]>(
  kind: Kind,
  range: SourceRange,
): ConcreteNode<Kind> =>
  Object.freeze({ kind, range, children: Object.freeze([]) });

const atxHeading = (content: string): AtxHeadingMatch | undefined => {
  const match = /^ {0,3}(#{1,6})(?:[\t ]+(.*?)|[\t ]*)$/u.exec(content);
  if (match === null) return undefined;

  const markers = match[1];
  if (markers === undefined) return undefined;

  const rawTitle = match[2] ?? "";
  const title = rawTitle.replace(/[\t ]+#+[\t ]*$/u, "").trim();
  return {
    level: markers.length as HeadingLevel,
    title,
  };
};

const setextHeading = (content: string): SetextHeadingMatch | undefined => {
  const match = /^ {0,3}(=+|-+)[\t ]*$/u.exec(content);
  const underline = match?.[1];
  if (underline === undefined) return undefined;
  return { level: underline[0] === "=" ? 1 : 2 };
};

const isBlank = (content: string): boolean => /^[\t ]*$/u.test(content);

const fence = (content: string): { marker: "`" | "~"; width: number } | undefined => {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(content);
  const markers = match?.[1];
  if (markers === undefined) return undefined;
  return { marker: markers[0] as "`" | "~", width: markers.length };
};

const isUnsupportedBlockStart = (content: string): boolean =>
  fence(content) !== undefined ||
  /^(?: {4}|\t)/u.test(content) ||
  /^ {0,3}>/u.test(content) ||
  /^ {0,3}(?:[*+-][\t ]+|\d{1,9}[.)][\t ]+)/u.test(content) ||
  /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:_[\t ]*){3,}|(?:-[\t ]*){3,})$/u.test(
    content,
  ) ||
  /^ {0,3}\[[^\]]+\]:/u.test(content) ||
  /^ {0,3}<(?:[A-Za-z!/]|\?)/u.test(content);

const fenceEnd = (
  lines: readonly SourceLine[],
  start: number,
  opener: { readonly marker: "`" | "~"; readonly width: number },
): number => {
  for (let current = start + 1; current < lines.length; current += 1) {
    const content = lines[current]?.content;
    if (content === undefined) break;
    const match = /^ {0,3}(`+|~+)[\t ]*$/u.exec(content);
    const markers = match?.[1];
    if (
      markers !== undefined &&
      markers[0] === opener.marker &&
      markers.length >= opener.width
    ) {
      return current;
    }
  }
  return lines.length - 1;
};

const parseBlocks = (
  lines: readonly SourceLine[],
  index: SourceIndex,
  path: string | undefined,
): { readonly blocks: readonly ParsedBlock[]; readonly diagnostics: readonly Diagnostic[] } => {
  const blocks: ParsedBlock[] = [];
  const diagnostics: Diagnostic[] = [];
  let current = 0;

  const addOpaque = (startLine: number, endLine: number): void => {
    const first = lines[startLine];
    const last = lines[endLine];
    if (first === undefined || last === undefined) return;

    const range = index.range(first.start, last.end);
    const concrete = concreteNode("opaque", range);
    const reason = "unsupported-block";
    const derived: OpaqueBlock = Object.freeze({
      type: "opaque",
      range,
      concrete,
      reason,
    });
    blocks.push(Object.freeze({ concrete, derived }));
    diagnostics.push(
      Object.freeze({
        code: "markdown.opaque-block",
        severity: "warning",
        message: "Preserved an unsupported Markdown block as opaque source.",
        source: "markdown",
        ...(path === undefined ? {} : { path }),
        range,
      }),
    );
  };

  while (current < lines.length) {
    const line = lines[current];
    if (line === undefined) break;

    if (isBlank(line.content)) {
      const range = index.range(line.start, line.end);
      const concrete = concreteNode("blank-line", range);
      const derived: BlankLine = Object.freeze({
        type: "blank-line",
        range,
        concrete,
      });
      blocks.push(Object.freeze({ concrete, derived }));
      current += 1;
      continue;
    }

    const atx = atxHeading(line.content);
    if (atx !== undefined) {
      const range = index.range(line.start, line.end);
      const concrete = concreteNode("atx-heading", range);
      const derived: Heading = Object.freeze({
        type: "heading",
        range,
        concrete,
        level: atx.level,
        title: atx.title,
        style: "atx",
      });
      blocks.push(Object.freeze({ concrete, derived }));
      current += 1;
      continue;
    }

    const opener = fence(line.content);
    if (opener !== undefined) {
      const end = fenceEnd(lines, current, opener);
      addOpaque(current, end);
      current = end + 1;
      continue;
    }

    if (
      setextHeading(line.content) !== undefined ||
      isUnsupportedBlockStart(line.content)
    ) {
      addOpaque(current, current);
      current += 1;
      continue;
    }

    const start = current;
    const titleLines: string[] = [];
    let setext: SetextHeadingMatch | undefined;

    while (current < lines.length) {
      const paragraphLine = lines[current];
      if (paragraphLine === undefined) break;

      if (titleLines.length > 0) {
        setext = setextHeading(paragraphLine.content);
        if (setext !== undefined) {
          current += 1;
          break;
        }
      }

      if (
        isBlank(paragraphLine.content) ||
        atxHeading(paragraphLine.content) !== undefined ||
        isUnsupportedBlockStart(paragraphLine.content)
      ) {
        break;
      }

      titleLines.push(paragraphLine.content);
      current += 1;
    }

    const first = lines[start];
    const last = lines[current - 1];
    if (first === undefined || last === undefined) continue;
    const range = index.range(first.start, last.end);

    if (setext !== undefined) {
      const concrete = concreteNode("setext-heading", range);
      const derived: Heading = Object.freeze({
        type: "heading",
        range,
        concrete,
        level: setext.level,
        title: titleLines.join(" ").trim(),
        style: "setext",
      });
      blocks.push(Object.freeze({ concrete, derived }));
      continue;
    }

    const concrete = concreteNode("paragraph", range);
    const derived: Paragraph = Object.freeze({
      type: "paragraph",
      range,
      concrete,
    });
    blocks.push(Object.freeze({ concrete, derived }));
  }

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
  const index = makeSourceIndex(source);
  const contentStart = source.startsWith("\uFEFF") ? 1 : 0;
  const lines = splitLines(source, contentStart);
  const sourceText = makeSourceText(source, lines, index);
  const parsed = parseBlocks(lines, index, options.path);
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
