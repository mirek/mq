import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import {
  compileExpression,
  evaluate,
  isMarkdownNode,
  nodeMarkdown,
  parse,
  toJsonValue,
  type Diagnostic,
  type Document,
  type QueryValue,
} from "@prelude/mq";

const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const mq = join(workspace, "node_modules", ".bin", "mq");
let directory = "";

before(() => {
  directory = mkdtempSync(join(tmpdir(), "mq-equivalence-"));
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

const run = (
  args: readonly string[],
  input = "",
): SpawnSyncReturns<string> =>
  spawnSync(mq, args, { cwd: directory, encoding: "utf8", input });

const successfulOutput = (result: SpawnSyncReturns<string>): string => {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  return result.stdout;
};

const direct = (
  source: string,
  expression: string,
  path?: string,
): { readonly document: Document; readonly values: readonly QueryValue[] } => {
  const parsed = parse(source, path === undefined ? {} : { path });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("fixture did not parse");
  const compiled = compileExpression(expression);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("fixture expression did not compile");
  return {
    document: parsed.value,
    values: evaluate(parsed.value, compiled.value),
  };
};

const jsonLines = (text: string): readonly unknown[] =>
  text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);

const diagnosticLines = (text: string): readonly Diagnostic[] =>
  jsonLines(text) as readonly Diagnostic[];

const source = [
  "preamble 😀",
  "# One",
  "one body",
  "## Two",
  "two body",
  "# Three",
  "three body",
  "",
].join("\r\n");

describe("public API and installed CLI equivalence", () => {
  it("emits the same canonical values in the same order", () => {
    const expressions = [
      ".",
      'select("heading")',
      'select("heading") | text',
      'select("heading") | count',
      'select("heading") | first',
      'select("heading") | last',
      'select("heading") | array',
      'select("section[level=6]")',
    ];

    for (const expression of expressions) {
      const query = direct(source, expression);
      const expected = query.values.map((value) =>
        toJsonValue(query.document, value),
      );
      const result = run(["--json", expression], source);

      assert.equal(result.error, undefined, expression);
      assert.equal(result.status, 0, expression);
      assert.equal(result.stderr, "", expression);
      assert.deepEqual(jsonLines(result.stdout), expected, expression);
    }
  });

  it("serializes nodes, strings, and structures exactly like the API contracts", () => {
    const nodeQuery = direct(source, 'select("heading")');
    const expectedNodes = nodeQuery.values
      .filter(isMarkdownNode)
      .map((node) => nodeMarkdown(nodeQuery.document, node))
      .join("");
    assert.equal(
      successfulOutput(run(['select("heading")'], source)),
      expectedNodes,
    );

    const textQuery = direct(source, 'select("heading") | text');
    const expectedText = textQuery.values
      .map((value) => `${JSON.stringify(toJsonValue(textQuery.document, value))}\n`)
      .join("");
    const expectedRaw = textQuery.values.map((value) => `${String(value)}\n`).join("");
    assert.equal(
      successfulOutput(run(['select("heading") | text'], source)),
      expectedText,
    );
    assert.equal(
      successfulOutput(
        run(["--raw-output", 'select("heading") | text'], source),
      ),
      expectedRaw,
    );

    const arrayQuery = direct(source, 'select("heading") | array');
    const expectedArray = arrayQuery.values
      .map((value) => `${JSON.stringify(toJsonValue(arrayQuery.document, value))}\n`)
      .join("");
    assert.equal(
      successfulOutput(run(['select("heading") | array'], source)),
      expectedArray,
    );
  });

  it("returns the same expression diagnostics as the compiler", () => {
    const compiled = compileExpression("wat");
    assert.equal(compiled.ok, false);
    if (compiled.ok) return;

    const result = run(["--diagnostics", "json", "wat"], source);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.deepEqual(diagnosticLines(result.stderr), compiled.diagnostics);
  });

  it("returns parse diagnostics in the same order as the parser", () => {
    const opaque = "[first]: /one\n\n[second]: /two\n";
    const parsed = parse(opaque);
    assert.equal(parsed.ok, true);

    const result = run(["--quiet", "--diagnostics", "json", "."], opaque);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.deepEqual(diagnosticLines(result.stderr), parsed.diagnostics);
  });

  it("preserves direct evaluation order across input files", () => {
    const fixtures = [
      ["one.md", "# One\n## Child\n"],
      ["two.md", "# Two\n"],
    ] as const;
    for (const [path, markdown] of fixtures) {
      writeFileSync(join(directory, path), markdown);
    }

    const expression = 'select("heading") | text';
    const expected = fixtures.flatMap(([path, markdown]) =>
      direct(markdown, expression, path).values,
    );
    const result = run(["--json", expression, ...fixtures.map(([path]) => path)]);

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(jsonLines(result.stdout), expected);
  });

  it("derives fail-empty status from the same empty API stream", () => {
    const expression = 'select("heading[level=6]")';
    assert.deepEqual(direct(source, expression).values, []);

    const result = run(["--fail-empty", expression], source);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
});
