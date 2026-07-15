import type { SourceRange } from "./source.ts";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticSource =
  | "markdown"
  | "selector"
  | "expression"
  | "schema";

export interface DiagnosticNote {
  readonly message: string;
  readonly path?: string;
  readonly range?: SourceRange;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source?: DiagnosticSource;
  readonly path?: string;
  readonly range?: SourceRange;
  readonly notes?: readonly DiagnosticNote[];
}
