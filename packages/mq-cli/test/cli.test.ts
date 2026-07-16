import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let directory = "";

before(() => {
  directory = mkdtempSync(join(tmpdir(), "mq-cli-"));
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

const run = (
  args: readonly string[],
  input = "",
): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
    input,
  });

const assertResult = (
  result: SpawnSyncReturns<string>,
  status: number,
  stdout: string,
  stderr: string,
): void => {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, status);
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, stderr);
};

describe("mq query CLI", () => {
  it("prints stable help without reading input", () => {
    const help = [
      "Usage: mq [options] [expression] [file ...]",
      "",
      "Query Markdown documents as ordered value streams.",
      "",
      "Arguments:",
      "  expression                 Query expression (default: .)",
      "  file ...                   Input files; omit for stdin, - also means stdin",
      "",
      "Options:",
      "  -r, --raw-output           Write strings without JSON quoting",
      "  -j, --json                 Encode every result as canonical JSON",
      "  -q, --quiet                Suppress results",
      "  -n, --null-input           Evaluate one empty document without reading input",
      "      --fail-empty           Exit 1 when an input emits no values",
      "      --color <policy>       auto, always, or never (default: auto)",
      "      --diagnostics <format> human or json (default: human)",
      "  -h, --help                 Show this help",
      "",
    ].join("\n");

    assertResult(run(["--help"], "ignored"), 0, help, "");
    assertResult(run(["-h"], "ignored"), 0, help, "");
  });

  it("reads stdin and emits the default document as exact Markdown", () => {
    assertResult(run([], "# Café 😀\r\nbody"), 0, "# Café 😀\r\nbody", "");
    assertResult(run([".", "-"], "# Explicit\n"), 0, "# Explicit\n", "");
  });

  it("formats node, string, primitive, and structured query values", () => {
    const markdown = "# One\n## Two\n";

    assertResult(
      run(['select("heading[level=2]")'], markdown),
      0,
      "## Two\n",
      "",
    );
    assertResult(
      run(['select("heading") | text'], markdown),
      0,
      '"One"\n"Two"\n',
      "",
    );
    assertResult(
      run(["--raw-output", 'select("heading") | text'], markdown),
      0,
      "One\nTwo\n",
      "",
    );
    assertResult(
      run(['select("heading") | count'], markdown),
      0,
      "2\n",
      "",
    );
    assertResult(
      run(['select("heading") | array'], markdown),
      0,
      '[{"level":1,"style":"atx","title":"One","type":"heading"},{"level":2,"style":"atx","title":"Two","type":"heading"}]\n',
      "",
    );
  });

  it("forces canonical JSON for every result with --json", () => {
    assertResult(
      run(["--json", 'select("heading")'], "# One\n"),
      0,
      '{"level":1,"style":"atx","title":"One","type":"heading"}\n',
      "",
    );
  });

  it("evaluates files independently in argument order", () => {
    writeFileSync(join(directory, "one.md"), "# One\n");
    writeFileSync(join(directory, "two.md"), "# Two\n");

    assertResult(
      run(['select("heading") | text', "one.md", "two.md"]),
      0,
      '"One"\n"Two"\n',
      "",
    );
  });

  it("rejects ambiguous Markdown node output from multiple inputs", () => {
    writeFileSync(join(directory, "a.md"), "# A\n");
    writeFileSync(join(directory, "b.md"), "# B\n");

    assertResult(
      run(['select("heading")', "a.md", "b.md"]),
      2,
      "",
      "mq: error[cli.multiple-markdown-inputs]: Markdown node output from multiple inputs requires --json.\n",
    );
  });

  it("supports quiet, null-input, and fail-empty status behavior", () => {
    assertResult(run(["--quiet", 'select("heading")'], "# Hidden\n"), 0, "", "");
    assertResult(run(["--null-input", "count"], "ignored"), 0, "1\n", "");
    assertResult(
      run(["--fail-empty", 'select("heading[level=6]")'], "# None\n"),
      1,
      "",
      "",
    );
  });

  it("returns stable human and JSON expression diagnostics", () => {
    assertResult(
      run(["wat"], "# Ignored\n"),
      2,
      "",
      'expression:1:1: error[expression.syntax]: Unknown expression stage "wat".\n',
    );

    const json = run(["--diagnostics", "json", "wat"]);
    assert.equal(json.status, 2);
    assert.equal(json.stdout, "");
    assert.equal(
      json.stderr,
      '{"code":"expression.syntax","severity":"error","message":"Unknown expression stage \\"wat\\".","source":"expression","range":{"start":{"byteOffset":0,"line":1,"column":1,"utf16Column":1},"end":{"byteOffset":3,"line":1,"column":4,"utf16Column":4}}}\n',
    );
    assert.deepEqual(JSON.parse(json.stderr), {
      code: "expression.syntax",
      message: 'Unknown expression stage "wat".',
      range: {
        end: { byteOffset: 3, column: 4, line: 1, utf16Column: 4 },
        start: { byteOffset: 0, column: 1, line: 1, utf16Column: 1 },
      },
      severity: "error",
      source: "expression",
    });
  });

  it("applies the requested human diagnostic color policy", () => {
    const always = run(["--color", "always", "wat"]);
    assert.equal(always.status, 2);
    assert.equal(
      always.stderr.includes("\u001b[31merror[expression.syntax]\u001b[0m"),
      true,
    );

    const never = run(["--color", "never", "wat"]);
    assert.equal(never.status, 2);
    assert.equal(never.stderr.includes("\u001b["), false);
  });

  it("reports recovery warnings and I/O failures with stable statuses", () => {
    assertResult(
      run(["."], "[retained]: /target\n"),
      0,
      "[retained]: /target\n",
      "markdown:1:1: warning[markdown.opaque-block]: Preserved an unsupported Markdown block as opaque source.\n",
    );
    assertResult(
      run([".", "missing.md"]),
      3,
      "",
      "missing.md: error[cli.io]: Cannot read input file.\n",
    );
  });

  it("rejects invalid option combinations as usage errors", () => {
    assertResult(
      run(["--wat"]),
      2,
      "",
      'mq: error[cli.usage]: Unknown option "--wat".\n',
    );
    assertResult(
      run(["--json", "--raw-output"]),
      2,
      "",
      "mq: error[cli.usage]: --json and --raw-output cannot be combined.\n",
    );
    assertResult(
      run(["--quiet=yes"]),
      2,
      "",
      "mq: error[cli.usage]: Option --quiet does not accept a value.\n",
    );
    assertResult(
      run(["--null-input", ".", "file.md"]),
      2,
      "",
      "mq: error[cli.usage]: --null-input does not accept input files.\n",
    );
  });
});
