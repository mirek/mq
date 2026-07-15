import type { SourceRange } from "./source.ts";

export type ConcreteNodeKind =
  | "document"
  | "bom"
  | "blank-line"
  | "atx-heading"
  | "setext-heading"
  | "paragraph"
  | "opaque";

export interface ConcreteNode<
  Kind extends ConcreteNodeKind = ConcreteNodeKind,
> {
  readonly kind: Kind;
  readonly range: SourceRange;
  readonly children: readonly ConcreteNode[];
}

export type ConcreteDocument = ConcreteNode<"document">;
