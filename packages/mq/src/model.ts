import type { ConcreteDocument, ConcreteNode } from "./cst.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type { SourceRange, SourceText } from "./source.ts";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
  readonly type: "heading";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"atx-heading" | "setext-heading">;
  readonly level: HeadingLevel;
  readonly title: string;
  readonly style: "atx" | "setext";
  readonly inlineRange: SourceRange;
}

export interface Paragraph {
  readonly type: "paragraph";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"paragraph">;
  readonly inlineRange: SourceRange;
  readonly text: string;
}

export interface BlankLine {
  readonly type: "blank-line";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"blank-line">;
}

export interface OpaqueBlock {
  readonly type: "opaque";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"opaque">;
  readonly reason: string;
}

export interface Blockquote {
  readonly type: "blockquote";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"blockquote">;
  readonly children: readonly FlowNode[];
}

export interface ListBlock {
  readonly type: "list";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"list">;
  readonly ordered: boolean;
  readonly start: number | undefined;
  readonly tight: boolean;
  readonly children: readonly ListItem[];
}

export interface ListItem {
  readonly type: "item";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"item">;
  readonly checked?: boolean;
  readonly children: readonly FlowNode[];
}

export interface CodeBlock {
  readonly type: "code";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"fenced-code" | "indented-code">;
  readonly language?: string;
  readonly meta?: string;
  readonly fenced: boolean;
  readonly value: string;
}

export interface HtmlNode {
  readonly type: "html";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"html" | "html-inline">;
  readonly value: string;
}

export interface ThematicBreak {
  readonly type: "thematic-break";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"thematic-break">;
}

export type TableAlignment = "left" | "right" | "center" | undefined;

export interface Table {
  readonly type: "table";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"table">;
  readonly alignments: readonly TableAlignment[];
  readonly children: readonly TableRow[];
}

export interface TableRow {
  readonly type: "row";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"row">;
  readonly header: boolean;
  readonly children: readonly TableCell[];
}

export interface TableCell {
  readonly type: "cell";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"cell">;
  readonly alignment: TableAlignment;
  readonly header: boolean;
  readonly inlineRange: SourceRange;
  readonly text: string;
}

export type Block =
  | Paragraph
  | BlankLine
  | Blockquote
  | ListBlock
  | ListItem
  | CodeBlock
  | HtmlNode
  | ThematicBreak
  | Table
  | TableRow
  | TableCell
  | OpaqueBlock;

export type FlowNode = Heading | Block;

export interface TextInline {
  readonly type: "text";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode;
  readonly value: string;
}

export interface OpaqueInline {
  readonly type: "opaque";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"opaque">;
  readonly reason: string;
}

export interface Emphasis {
  readonly type: "emphasis";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"emphasis">;
  readonly children: readonly Inline[];
}

export interface Strong {
  readonly type: "strong";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"strong">;
  readonly children: readonly Inline[];
}

export interface Strikethrough {
  readonly type: "strikethrough";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"strikethrough">;
  readonly children: readonly Inline[];
}

export interface InlineCode {
  readonly type: "inline-code";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"inline-code">;
  readonly value: string;
}

export interface BreakInline {
  readonly type: "break";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"break">;
}

export interface Link {
  readonly type: "link";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"link">;
  readonly destination?: string;
  readonly title?: string;
  readonly reference?: string;
  readonly children: readonly Inline[];
}

export interface Image {
  readonly type: "image";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"image">;
  readonly destination?: string;
  readonly title?: string;
  readonly reference?: string;
  readonly alt: string;
}

export type Inline =
  | TextInline
  | Emphasis
  | Strong
  | Strikethrough
  | InlineCode
  | BreakInline
  | Link
  | Image
  | HtmlNode
  | OpaqueInline;

export type InlineContainer = Heading | Paragraph | TableCell;

export interface Section {
  readonly type: "section";
  readonly range: SourceRange;
  readonly level: HeadingLevel;
  readonly heading: Heading;
  readonly title: string;
  readonly body: readonly Block[];
  readonly sections: readonly Section[];
  readonly children: readonly (Heading | Block | Section)[];
}

export interface Document {
  readonly type: "document";
  readonly source: SourceText;
  readonly path?: string;
  readonly range: SourceRange;
  readonly diagnostics: readonly Diagnostic[];
  readonly cst: ConcreteDocument;
  readonly preamble: readonly Block[];
  readonly children: readonly (Block | Section)[];
  readonly sections: readonly Section[];
}

export type MarkdownNode = Document | Section | FlowNode | Inline;
