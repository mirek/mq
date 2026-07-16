import type { Diagnostic } from "./diagnostic.ts";
import { failure, success, type Result } from "./result.ts";
import {
  sourcePosition,
  sourceRange,
  type SourcePosition,
  type SourceRange,
} from "./source.ts";

export interface SourcePatch {
  readonly range: SourceRange;
  readonly replacement: string;
}

export interface SourcePatchPlan {
  readonly patches: readonly SourcePatch[];
}

export interface SourceMapSegment {
  readonly kind: "retained" | "replacement";
  readonly original: SourceRange;
  readonly generated: SourceRange;
}

export interface SourceMap {
  readonly segments: readonly SourceMapSegment[];
}

export interface PatchedSource {
  readonly text: string;
  readonly byteLength: number;
  readonly map: SourceMap;
}

interface Boundary {
  readonly utf16Offset: number;
  readonly position: SourcePosition;
}

interface SourceIndex {
  readonly byteLength: number;
  readonly boundaries: ReadonlyMap<number, Boundary>;
}

interface SegmentOffsets {
  readonly kind: "retained" | "replacement";
  readonly originalStart: number;
  readonly originalEnd: number;
  readonly generatedStart: number;
  readonly generatedEnd: number;
}

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const makeSourceIndex = (text: string): SourceIndex => {
  const boundaries = new Map<number, Boundary>();
  let utf16Offset = 0;
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;

  const record = (): void => {
    boundaries.set(byteOffset, {
      utf16Offset,
      position: sourcePosition(byteOffset, line, column, utf16Column),
    });
  };
  record();

  if (text.startsWith("\uFEFF")) {
    utf16Offset = 1;
    byteOffset = 3;
    record();
  }

  while (utf16Offset < text.length) {
    if (text[utf16Offset] === "\r" && text[utf16Offset + 1] === "\n") {
      utf16Offset += 1;
      byteOffset += 1;
      record();
      utf16Offset += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      record();
      continue;
    }
    if (text[utf16Offset] === "\r" || text[utf16Offset] === "\n") {
      utf16Offset += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      record();
      continue;
    }

    const codePoint = text.codePointAt(utf16Offset);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    utf16Offset += width;
    byteOffset += utf8Width(codePoint);
    column += 1;
    utf16Column += width;
    record();
  }

  return { byteLength: byteOffset, boundaries };
};

const samePosition = (left: SourcePosition, right: SourcePosition): boolean =>
  left.byteOffset === right.byteOffset &&
  left.line === right.line &&
  left.column === right.column &&
  left.utf16Column === right.utf16Column;

const editDiagnostic = (
  code: string,
  message: string,
  range?: SourceRange,
  notes?: Diagnostic["notes"],
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error",
    message,
    source: "edit",
    ...(range === undefined ? {} : { range }),
    ...(notes === undefined ? {} : { notes: Object.freeze([...notes]) }),
  });

const plans = new WeakMap<SourcePatchPlan, { source: string; index: SourceIndex }>();

const validatedPatch = (
  patch: SourcePatch,
  index: SourceIndex,
): Result<SourcePatch> => {
  const start = index.boundaries.get(patch.range.start.byteOffset);
  const end = index.boundaries.get(patch.range.end.byteOffset);
  if (
    start === undefined ||
    end === undefined ||
    patch.range.end.byteOffset < patch.range.start.byteOffset ||
    !samePosition(start.position, patch.range.start) ||
    !samePosition(end.position, patch.range.end)
  ) {
    return failure(
      editDiagnostic(
        "edit.range",
        "Patch range must exactly belong to the original UTF-8 source.",
        patch.range,
      ),
    );
  }
  return success(
    Object.freeze({
      range: sourceRange(start.position, end.position),
      replacement: patch.replacement,
    }),
  );
};

const conflict = (
  left: SourcePatch,
  right: SourcePatch,
): "ambiguity" | "overlap" | undefined => {
  const leftStart = left.range.start.byteOffset;
  const leftEnd = left.range.end.byteOffset;
  const rightStart = right.range.start.byteOffset;
  const rightEnd = right.range.end.byteOffset;
  const leftInsertion = leftStart === leftEnd;
  const rightInsertion = rightStart === rightEnd;

  if (leftStart === rightStart && (leftInsertion || rightInsertion)) {
    return "ambiguity";
  }
  if (rightStart < leftEnd) return "overlap";
  return undefined;
};

/** Validates and deterministically orders patches against one source snapshot. */
export const planSourcePatches = (
  source: string,
  patches: readonly SourcePatch[],
): Result<SourcePatchPlan> => {
  const index = makeSourceIndex(source);
  const validated: SourcePatch[] = [];
  for (const patch of patches) {
    const result = validatedPatch(patch, index);
    if (!result.ok) return result;
    validated.push(result.value);
  }
  validated.sort(
    (left, right) =>
      left.range.start.byteOffset - right.range.start.byteOffset ||
      left.range.end.byteOffset - right.range.end.byteOffset,
  );

  for (let patchIndex = 1; patchIndex < validated.length; patchIndex += 1) {
    const left = validated[patchIndex - 1]!;
    const right = validated[patchIndex]!;
    const kind = conflict(left, right);
    if (kind === undefined) continue;
    const code = kind === "overlap" ? "edit.patch-overlap" : "edit.patch-ambiguity";
    return failure(
      editDiagnostic(
        code,
        kind === "overlap"
          ? "Source patches overlap in the original snapshot."
          : "Source patches have an ambiguous insertion order.",
        left.range,
        [
          Object.freeze({ message: "First conflicting patch.", range: left.range }),
          Object.freeze({ message: "Second conflicting patch.", range: right.range }),
        ],
      ),
    );
  }

  const plan = Object.freeze({ patches: Object.freeze(validated) });
  plans.set(plan, { source, index });
  return success(plan);
};

const mappedRange = (
  index: SourceIndex,
  start: number,
  end: number,
): SourceRange => {
  const startBoundary = index.boundaries.get(start);
  const endBoundary = index.boundaries.get(end);
  if (startBoundary === undefined || endBoundary === undefined) {
    throw new TypeError("source map offsets must be UTF-8 boundaries");
  }
  return sourceRange(startBoundary.position, endBoundary.position);
};

/** Applies a validated patch plan and returns text plus exact source-map spans. */
export const applySourcePatches = (plan: SourcePatchPlan): PatchedSource => {
  const planned = plans.get(plan);
  if (planned === undefined) {
    throw new TypeError("patch plan must be produced by planSourcePatches");
  }

  const parts: string[] = [];
  const segments: SegmentOffsets[] = [];
  let originalOffset = 0;
  let generatedOffset = 0;

  for (const patch of plan.patches) {
    const patchStart = patch.range.start.byteOffset;
    const patchEnd = patch.range.end.byteOffset;
    if (patchStart > originalOffset) {
      const start = planned.index.boundaries.get(originalOffset)!;
      const end = planned.index.boundaries.get(patchStart)!;
      parts.push(planned.source.slice(start.utf16Offset, end.utf16Offset));
      const length = patchStart - originalOffset;
      segments.push({
        kind: "retained",
        originalStart: originalOffset,
        originalEnd: patchStart,
        generatedStart: generatedOffset,
        generatedEnd: generatedOffset + length,
      });
      generatedOffset += length;
    }

    parts.push(patch.replacement);
    const replacementBytes = makeSourceIndex(patch.replacement).byteLength;
    segments.push({
      kind: "replacement",
      originalStart: patchStart,
      originalEnd: patchEnd,
      generatedStart: generatedOffset,
      generatedEnd: generatedOffset + replacementBytes,
    });
    generatedOffset += replacementBytes;
    originalOffset = patchEnd;
  }

  if (originalOffset < planned.index.byteLength) {
    const start = planned.index.boundaries.get(originalOffset)!;
    parts.push(planned.source.slice(start.utf16Offset));
    const length = planned.index.byteLength - originalOffset;
    segments.push({
      kind: "retained",
      originalStart: originalOffset,
      originalEnd: planned.index.byteLength,
      generatedStart: generatedOffset,
      generatedEnd: generatedOffset + length,
    });
    generatedOffset += length;
  }

  const text = parts.join("");
  const generatedIndex = makeSourceIndex(text);
  const mapped = Object.freeze(
    segments.map((segment): SourceMapSegment =>
      Object.freeze({
        kind: segment.kind,
        original: mappedRange(
          planned.index,
          segment.originalStart,
          segment.originalEnd,
        ),
        generated: mappedRange(
          generatedIndex,
          segment.generatedStart,
          segment.generatedEnd,
        ),
      }),
    ),
  );
  return Object.freeze({
    text,
    byteLength: generatedOffset,
    map: Object.freeze({ segments: mapped }),
  });
};
