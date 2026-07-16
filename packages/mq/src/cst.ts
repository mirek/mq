import type { SourceRange } from "./source.ts";

export type ConcreteNodeKind =
  | "document"
  | "bom"
  | "blank-line"
  | "frontmatter"
  | "definition"
  | "atx-heading"
  | "setext-heading"
  | "paragraph"
  | "blockquote"
  | "list"
  | "item"
  | "fenced-code"
  | "indented-code"
  | "html"
  | "html-inline"
  | "thematic-break"
  | "text"
  | "emphasis"
  | "strong"
  | "inline-code"
  | "break"
  | "link"
  | "image"
  | "table"
  | "row"
  | "cell"
  | "strikethrough"
  | "opaque";

export interface ConcreteNode<
  Kind extends ConcreteNodeKind = ConcreteNodeKind,
> {
  readonly kind: Kind;
  readonly range: SourceRange;
  readonly children: readonly ConcreteNode[];
}

export type ConcreteDocument = ConcreteNode<"document">;
