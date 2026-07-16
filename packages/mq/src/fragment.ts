import type { Diagnostic } from "./diagnostic.ts";
import type { Document } from "./model.ts";
import { parse, type ParseOptions } from "./parse.ts";
import { failure, success, type Result } from "./result.ts";
import { planSourcePatches, type SourcePatch } from "./source-patch.ts";
import { sourceRange, type SourcePosition } from "./source.ts";

export interface MarkdownFragment {
  readonly source: string;
  readonly document: Document;
}

const fragments = new WeakSet<MarkdownFragment>();

const fragmentDiagnostic = (
  code: string,
  message: string,
  at: SourcePosition,
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error",
    message,
    source: "edit",
    range: sourceRange(at, at),
  });

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const utf16OffsetAtByte = (source: string, target: number): number | undefined => {
  let utf16Offset = 0;
  let byteOffset = 0;
  while (utf16Offset < source.length && byteOffset < target) {
    const codePoint = source.codePointAt(utf16Offset);
    if (codePoint === undefined) break;
    utf16Offset += codePoint > 0xffff ? 2 : 1;
    byteOffset += utf8Width(codePoint);
  }
  return byteOffset === target ? utf16Offset : undefined;
};

const startsWithNewline = (source: string): boolean =>
  /^(?:\r\n|\r|\n)/u.test(source);

const endsWithNewline = (source: string): boolean =>
  /(?:\r\n|\r|\n)$/u.test(source);

/** Parses a reusable Markdown fragment with the same lossless parser as documents. */
export const parseMarkdownFragment = (
  source: string,
  options: ParseOptions = {},
): Result<MarkdownFragment> => {
  const parsed = parse(source, options);
  if (!parsed.ok) return parsed;
  const fragment = Object.freeze({ source, document: parsed.value });
  fragments.add(fragment);
  return success(fragment, parsed.diagnostics);
};

/** Plans one line-boundary insertion patch without normalizing fragment text. */
export const planFragmentInsertion = (
  document: Document,
  fragment: MarkdownFragment,
  at: SourcePosition,
): Result<SourcePatch> => {
  if (!fragments.has(fragment)) {
    throw new TypeError("fragment must be produced by parseMarkdownFragment");
  }

  const emptyPatch: SourcePatch = {
    range: sourceRange(at, at),
    replacement: "",
  };
  const validated = planSourcePatches(document.source.text, [emptyPatch]);
  if (!validated.ok) return validated;
  const canonicalRange = validated.value.patches[0]!.range;
  if (fragment.source.length === 0) {
    return success(Object.freeze({ range: canonicalRange, replacement: "" }));
  }

  const offset = utf16OffsetAtByte(document.source.text, at.byteOffset);
  if (offset === undefined) {
    throw new TypeError("validated fragment boundary must be a UTF-8 boundary");
  }
  const left = document.source.text.slice(0, offset);
  const right = document.source.text.slice(offset);
  const splitsCrlf = left.endsWith("\r") && right.startsWith("\n");
  const lineBoundary =
    offset === 0 ||
    offset === document.source.text.length ||
    endsWithNewline(left) ||
    startsWithNewline(right);
  if (splitsCrlf || !lineBoundary) {
    return failure(
      fragmentDiagnostic(
        "edit.fragment-boundary",
        "Markdown fragments can only be inserted at complete line boundaries.",
        at,
      ),
    );
  }

  const newline = document.source.dominantNewline ?? "\n";
  const prefix =
    left.length > 0 &&
    !endsWithNewline(left) &&
    !startsWithNewline(fragment.source)
      ? newline
      : "";
  const suffix =
    right.length > 0 &&
    !endsWithNewline(fragment.source) &&
    !startsWithNewline(right)
      ? newline
      : "";
  return success(
    Object.freeze({
      range: canonicalRange,
      replacement: `${prefix}${fragment.source}${suffix}`,
    }),
  );
};
