import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEdits,
  compileExpression,
  compileSelector,
  evaluate,
  loadSchema,
  MQ_SCHEMA_V1,
  parse,
  render,
  select,
  setTitleEdit,
  validate,
} from "../src/index.ts";

const seed = 0x6d_71_f0_22;

const generator = () => {
  let state = seed;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  return {
    integer: (limit: number): number => next() % limit,
    state: (): number => state >>> 0,
  };
};

const alphabet = [
  "",
  " ",
  "\t",
  "\n",
  "\r",
  "#",
  "*",
  "_",
  "`",
  "~",
  "[",
  "]",
  "(",
  ")",
  "<",
  ">",
  "{",
  "}",
  ":",
  "=",
  "\\",
  '"',
  "'",
  "-",
  "+",
  "|",
  "!",
  "\0",
  "a",
  "Z",
  "7",
  "é",
  "東",
  "😀",
  "\ud800",
] as const;

const randomString = (
  random: ReturnType<typeof generator>,
  maximum: number,
): string => {
  const length = random.integer(maximum + 1);
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[random.integer(alphabet.length)];
  }
  return value;
};

const randomJson = (
  random: ReturnType<typeof generator>,
  depth = 0,
): unknown => {
  const kind = depth >= 3 ? random.integer(4) : random.integer(7);
  if (kind === 0) return null;
  if (kind === 1) return random.integer(2) === 0;
  if (kind === 2) return random.integer(10_000) - 5_000;
  if (kind === 3) return randomString(random, 48);
  if (kind === 4) {
    return Array.from({ length: random.integer(8) }, () => randomJson(random, depth + 1));
  }
  const value: Record<string, unknown> = {};
  for (let index = 0; index < random.integer(8); index += 1) {
    value[randomString(random, 16)] = randomJson(random, depth + 1);
  }
  if (kind === 6) value.$schema = randomString(random, 48);
  return value;
};

describe("bounded language fuzz campaigns", () => {
  it(
    "preserves Markdown losslessness and edit source locality",
    { timeout: 15_000 },
    () => {
      const random = generator();
      const heading = compileSelector("heading");
      assert.equal(heading.ok, true);
      if (!heading.ok) return;
      let successfulEdits = 0;

      for (let index = 0; index < 512; index += 1) {
        const source = randomString(random, 384);
        const parsed = parse(source);
        assert.equal(parsed.ok, true, `seed=${seed} case=${index} state=${random.state()}`);
        if (!parsed.ok) continue;
        assert.equal(render(parsed.value), source, `seed=${seed} case=${index}`);

        const edited = applyEdits(parsed.value, [
          setTitleEdit(heading.value, randomString(random, 32)),
        ]);
        if (!edited.ok) {
          assert.equal(edited.diagnostics.length > 0, true);
          assert.equal(render(parsed.value), source);
          continue;
        }
        successfulEdits += 1;
        assert.equal(render(edited.value), edited.value.source.text);
        assert.equal(render(parsed.value), source);

        const map = edited.value.sourceMap;
        if (map === undefined) {
          assert.strictEqual(edited.value, parsed.value);
          continue;
        }
        const originalBytes = Buffer.from(source);
        const generatedBytes = Buffer.from(edited.value.source.text);
        for (const segment of map.segments) {
          if (segment.kind !== "retained") continue;
          assert.deepEqual(
            generatedBytes.subarray(
              segment.generated.start.byteOffset,
              segment.generated.end.byteOffset,
            ),
            originalBytes.subarray(
              segment.original.start.byteOffset,
              segment.original.end.byteOffset,
            ),
            `seed=${seed} case=${index}`,
          );
        }
      }
      assert.equal(successfulEdits > 0, true);
    },
  );

  it(
    "bounds selector, expression, and schema language failures as data",
    { timeout: 15_000 },
    () => {
      const random = generator();
      const document = parse("# One\n## Two\ntext\n");
      assert.equal(document.ok, true);
      if (!document.ok) return;

      for (let index = 0; index < 1_024; index += 1) {
        const language = randomString(random, 192);
        const selector = compileSelector(language);
        if (selector.ok) select(document.value, selector.value);

        const expression = compileExpression(language);
        if (expression.ok) evaluate(document.value, expression.value);

        const rawSchema = loadSchema(language);
        if (rawSchema.ok) validate(document.value, rawSchema.value);

        const jsonSchema = loadSchema(JSON.stringify(randomJson(random)));
        if (jsonSchema.ok) validate(document.value, jsonSchema.value);

        const typedSchema = loadSchema({
          $schema: MQ_SCHEMA_V1,
          rules: [
            {
              selector: language,
              count: { min: random.integer(4), max: random.integer(4) + 4 },
            },
          ],
        });
        if (typedSchema.ok) validate(document.value, typedSchema.value);
      }
    },
  );
});
