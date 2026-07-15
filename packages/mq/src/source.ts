export interface SourcePosition {
  /** Zero-based UTF-8 byte offset. */
  readonly byteOffset: number;
  /** One-based line number. */
  readonly line: number;
  /** One-based Unicode code-point column. */
  readonly column: number;
  /** One-based UTF-16 code-unit column for editor protocols. */
  readonly utf16Column: number;
}

export interface SourceRange {
  /** Inclusive start position. */
  readonly start: SourcePosition;
  /** Exclusive end position. */
  readonly end: SourcePosition;
}

export type NewlineStyle = "\n" | "\r\n" | "\r";

export interface NewlineOccurrence {
  readonly style: NewlineStyle;
  readonly range: SourceRange;
}

export interface SourceText {
  readonly text: string;
  readonly byteLength: number;
  readonly bom?: SourceRange;
  readonly dominantNewline: NewlineStyle | undefined;
  readonly mixedNewlines: readonly NewlineOccurrence[];
  readonly hasFinalNewline: boolean;
}

const nonNegativeInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
};

const positiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
};

export const sourcePosition = (
  byteOffset: number,
  line: number,
  column: number,
  utf16Column: number = column,
): SourcePosition => {
  nonNegativeInteger("byteOffset", byteOffset);
  positiveInteger("line", line);
  positiveInteger("column", column);
  positiveInteger("utf16Column", utf16Column);

  return Object.freeze({ byteOffset, line, column, utf16Column });
};

export const sourceRange = (
  start: SourcePosition,
  end: SourcePosition,
): SourceRange => {
  if (end.byteOffset < start.byteOffset) {
    throw new RangeError("range end must not precede its start");
  }

  return Object.freeze({ start, end });
};
