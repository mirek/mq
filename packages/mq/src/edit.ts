import type { Diagnostic } from "./diagnostic.ts";
import {
  planFragmentInsertion,
  type MarkdownFragment,
} from "./fragment.ts";
import type { Document, Heading, MarkdownNode } from "./model.ts";
import { parse } from "./parse.ts";
import { failure, success, type Result } from "./result.ts";
import { select, type CompiledSelector } from "./selector.ts";
import {
  applySourcePatches,
  planSourcePatches,
  type SourcePatch,
  type SourcePatchPlan,
} from "./source-patch.ts";
import { sourcePosition, sourceRange, type SourcePosition } from "./source.ts";

type AttributeValue = string | number | boolean;
type FragmentEditKind = "after" | "append" | "before" | "prepend" | "replace";

interface FragmentEdit {
  readonly kind: FragmentEditKind;
  readonly selector: CompiledSelector;
  readonly fragment: MarkdownFragment;
}

interface RemoveEdit {
  readonly kind: "remove";
  readonly selector: CompiledSelector;
}

interface SetTitleEdit {
  readonly kind: "set-title";
  readonly selector: CompiledSelector;
  readonly title: string;
}

interface SetAttributeEdit {
  readonly kind: "set-attribute";
  readonly selector: CompiledSelector;
  readonly name: string;
  readonly value: AttributeValue;
}

export type EditOperation =
  | FragmentEdit
  | RemoveEdit
  | SetTitleEdit
  | SetAttributeEdit;

const operations = new WeakSet<EditOperation>();

const operation = <T extends EditOperation>(value: T): T => {
  const frozen = Object.freeze(value) as T;
  operations.add(frozen);
  return frozen;
};

const fragmentEdit = (
  kind: FragmentEditKind,
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => operation({ kind, selector, fragment });

export const replaceEdit = (
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => fragmentEdit("replace", selector, fragment);

export const beforeEdit = (
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => fragmentEdit("before", selector, fragment);

export const afterEdit = (
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => fragmentEdit("after", selector, fragment);

export const prependEdit = (
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => fragmentEdit("prepend", selector, fragment);

export const appendEdit = (
  selector: CompiledSelector,
  fragment: MarkdownFragment,
): EditOperation => fragmentEdit("append", selector, fragment);

export const removeEdit = (selector: CompiledSelector): EditOperation =>
  operation({ kind: "remove", selector });

export const setTitleEdit = (
  selector: CompiledSelector,
  title: string,
): EditOperation => operation({ kind: "set-title", selector, title });

export const setAttributeEdit = (
  selector: CompiledSelector,
  name: string,
  value: AttributeValue,
): EditOperation =>
  operation({ kind: "set-attribute", selector, name: name.toLowerCase(), value });

const editDiagnostic = (
  code: string,
  message: string,
  node: MarkdownNode,
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error",
    message,
    source: "edit",
    range: node.range,
  });

const utf8Width = (codePoint: number): number => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const positionAtByte = (source: string, target: number): SourcePosition => {
  let index = 0;
  let byteOffset = 0;
  let line = 1;
  let column = 1;
  let utf16Column = 1;
  if (source.startsWith("\uFEFF")) {
    if (target === 0) return sourcePosition(0, 1, 1, 1);
    index = 1;
    byteOffset = 3;
    if (target === 3) return sourcePosition(3, 1, 1, 1);
  }
  while (index < source.length && byteOffset < target) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      index += 1;
      byteOffset += 1;
      if (byteOffset === target) {
        return sourcePosition(byteOffset, line, column, utf16Column);
      }
      index += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }
    if (source[index] === "\r" || source[index] === "\n") {
      index += 1;
      byteOffset += 1;
      line += 1;
      column = 1;
      utf16Column = 1;
      continue;
    }
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const width = codePoint > 0xffff ? 2 : 1;
    index += width;
    byteOffset += utf8Width(codePoint);
    column += 1;
    utf16Column += width;
  }
  if (byteOffset !== target) throw new TypeError("edit offset must be a UTF-8 boundary");
  return sourcePosition(byteOffset, line, column, utf16Column);
};

const utf16OffsetAtByte = (source: string, target: number): number => {
  let index = 0;
  let byteOffset = 0;
  while (index < source.length && byteOffset < target) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    index += codePoint > 0xffff ? 2 : 1;
    byteOffset += utf8Width(codePoint);
  }
  if (byteOffset !== target) throw new TypeError("edit offset must be a UTF-8 boundary");
  return index;
};

const sourceSlice = (document: Document, node: MarkdownNode): string =>
  document.source.text.slice(
    utf16OffsetAtByte(document.source.text, node.range.start.byteOffset),
    utf16OffsetAtByte(document.source.text, node.range.end.byteOffset),
  );

const patchAt = (
  document: Document,
  start: number,
  end: number,
  replacement: string,
): SourcePatch =>
  Object.freeze({
    range: sourceRange(
      positionAtByte(document.source.text, start),
      positionAtByte(document.source.text, end),
    ),
    replacement,
  });

const headingOf = (node: MarkdownNode): Heading | undefined =>
  node.type === "heading"
    ? node
    : node.type === "section"
      ? node.heading
      : undefined;

const insertionPosition = (
  node: MarkdownNode,
  kind: "append" | "prepend",
): Result<SourcePosition> => {
  if (node.type === "document") {
    return success(
      kind === "append"
        ? node.range.end
        : node.preamble[0]?.type === "frontmatter"
          ? node.preamble[0].range.end
          : (node.source.bom?.end ?? node.range.start),
    );
  }
  if (node.type === "section") {
    return success(kind === "append" ? node.range.end : node.heading.range.end);
  }
  return failure(
    editDiagnostic(
      "edit.target",
      `${kind} requires a document or section target.`,
      node,
    ),
  );
};

const replacementPatch = (
  document: Document,
  node: MarkdownNode,
  fragment: MarkdownFragment,
): SourcePatch => {
  const original = sourceSlice(document, node);
  const newline = document.source.dominantNewline ?? "\n";
  const needsFinalNewline =
    fragment.source.length > 0 &&
    /(?:\r\n|\r|\n)$/u.test(original) &&
    !/(?:\r\n|\r|\n)$/u.test(fragment.source);
  return Object.freeze({
    range: node.range,
    replacement: `${fragment.source}${needsFinalNewline ? newline : ""}`,
  });
};

const titlePatch = (
  node: MarkdownNode,
  title: string,
): Result<SourcePatch> => {
  const heading = headingOf(node);
  if (heading === undefined) {
    return failure(editDiagnostic("edit.target", "setTitle requires a heading or section.", node));
  }
  if (/\r|\n/u.test(title)) {
    return failure(editDiagnostic("edit.value", "Heading titles cannot contain newlines.", node));
  }
  const escaped = title.replace(/([\\`*_[\]<>#&])/gu, "\\$1");
  return success(
    Object.freeze({ range: heading.inlineRange, replacement: escaped }),
  );
};

const attributePatch = (
  document: Document,
  node: MarkdownNode,
  name: string,
  value: AttributeValue,
): Result<SourcePatch> => {
  const heading = headingOf(node);
  if (name === "level" && heading !== undefined) {
    if (
      heading.style !== "atx" ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 6
    ) {
      return failure(
        editDiagnostic(
          "edit.attribute",
          "ATX heading level requires an integer from 1 through 6.",
          node,
        ),
      );
    }
    const markdown = sourceSlice(document, heading);
    const match = /^( {0,3})(#{1,6})/u.exec(markdown);
    if (match === null) throw new TypeError("ATX heading must have an opening marker");
    const start = heading.range.start.byteOffset + match[1]!.length;
    return success(
      patchAt(document, start, start + match[2]!.length, "#".repeat(value)),
    );
  }

  if (name === "checked" && node.type === "item" && typeof value === "boolean") {
    const markdown = sourceSlice(document, node);
    const match = /^(?: {0,3})(?:[-+*]|\d+[.)])[\t ]+\[([ xX])\]/u.exec(markdown);
    if (match !== null) {
      const local = match[0].indexOf("[") + 1;
      const start = node.range.start.byteOffset + local;
      return success(patchAt(document, start, start + 1, value ? "x" : " "));
    }
  }

  return failure(
    editDiagnostic(
      "edit.attribute",
      `Attribute ${name} is not source-local for this target.`,
      node,
    ),
  );
};

/** Resolves all targets against one snapshot and plans their patches atomically. */
export const planEdits = (
  document: Document,
  editOperations: readonly EditOperation[],
): Result<SourcePatchPlan> => {
  const patches: SourcePatch[] = [];
  for (const edit of editOperations) {
    if (!operations.has(edit)) {
      throw new TypeError("edit operation must be produced by an edit constructor");
    }
    const targets = select(document, edit.selector);
    for (const target of targets) {
      if (edit.kind === "remove") {
        patches.push(Object.freeze({ range: target.range, replacement: "" }));
      } else if (edit.kind === "replace") {
        patches.push(replacementPatch(document, target, edit.fragment));
      } else if (edit.kind === "before" || edit.kind === "after") {
        const at = edit.kind === "before" ? target.range.start : target.range.end;
        const planned = planFragmentInsertion(document, edit.fragment, at);
        if (!planned.ok) return planned;
        patches.push(planned.value);
      } else if (edit.kind === "append" || edit.kind === "prepend") {
        const position = insertionPosition(target, edit.kind);
        if (!position.ok) return position;
        const planned = planFragmentInsertion(document, edit.fragment, position.value);
        if (!planned.ok) return planned;
        patches.push(planned.value);
      } else if (edit.kind === "set-title") {
        const planned = titlePatch(target, edit.title);
        if (!planned.ok) return planned;
        patches.push(planned.value);
      } else if (edit.kind === "set-attribute") {
        const planned = attributePatch(
          document,
          target,
          edit.name,
          edit.value,
        );
        if (!planned.ok) return planned;
        patches.push(planned.value);
      } else {
        throw new TypeError("unsupported edit operation");
      }
    }
  }
  return planSourcePatches(document.source.text, patches);
};

/** Applies a complete edit transaction and reparses one immutable snapshot. */
export const applyEdits = (
  document: Document,
  editOperations: readonly EditOperation[],
): Result<Document> => {
  const planned = planEdits(document, editOperations);
  if (!planned.ok) return planned;
  if (planned.value.patches.length === 0) return success(document);

  const applied = applySourcePatches(planned.value);
  const parsed = parse(
    applied.text,
    document.path === undefined ? {} : { path: document.path },
  );
  if (!parsed.ok) return parsed;
  const edited: Document = Object.freeze({
    ...parsed.value,
    sourceMap: applied.map,
  });
  return success(edited, parsed.diagnostics);
};
