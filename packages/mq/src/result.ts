import type { Diagnostic } from "./diagnostic.ts";

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
  readonly diagnostics: readonly Diagnostic[];
}

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface Failure {
  readonly ok: false;
  readonly diagnostics: NonEmptyReadonlyArray<Diagnostic>;
}

export type Result<T> = Success<T> | Failure;

const immutableDiagnostics = (
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] => Object.freeze([...diagnostics]);

const immutableNonEmptyDiagnostics = (
  diagnostic: Diagnostic,
  diagnostics: readonly Diagnostic[],
): NonEmptyReadonlyArray<Diagnostic> => {
  const values: [Diagnostic, ...Diagnostic[]] = [diagnostic, ...diagnostics];
  return Object.freeze(values);
};

export const success = <T>(
  value: T,
  diagnostics: readonly Diagnostic[] = [],
): Success<T> =>
  Object.freeze({
    ok: true,
    value,
    diagnostics: immutableDiagnostics(diagnostics),
  });

export const failure = (
  diagnostic: Diagnostic,
  ...diagnostics: readonly Diagnostic[]
): Failure =>
  Object.freeze({
    ok: false,
    diagnostics: immutableNonEmptyDiagnostics(diagnostic, diagnostics),
  });
