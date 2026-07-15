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
}

export interface Paragraph {
  readonly type: "paragraph";
  readonly range: SourceRange;
  readonly concrete: ConcreteNode<"paragraph">;
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

export type Block = Paragraph | BlankLine | OpaqueBlock;

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

export type Inline = TextInline | OpaqueInline;

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

export type MarkdownNode = Document | Section | Heading | Block | Inline;
