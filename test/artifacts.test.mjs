import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { after, before, describe, it } from "node:test";

import { verifyWorkflowGuides } from "../scripts/verify-workflow-guides.mjs";

const workspace = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "mq-artifacts-"));
let corePack;
let cliPack;

after(() => rmSync(temporary, { recursive: true, force: true }));

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    ...options,
  });
  assert.equal(result.error, undefined, `${command}: ${result.stderr}`);
  assert.equal(result.signal, null, command);
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
  return result;
};

const pack = (name) => {
  const result = run("pnpm", [
    "--filter",
    name,
    "pack",
    "--pack-destination",
    temporary,
    "--json",
  ]);
  return JSON.parse(result.stdout);
};

const tarText = (archive, path) =>
  run("tar", ["-xOf", archive, `package/${path}`]).stdout;

before(() => {
  corePack = pack("@prelude/mq");
  cliPack = pack("@prelude/mq-cli");
});

describe("packed package artifacts", () => {
  it("contains only declared runtime artifacts with self-contained source maps", () => {
    const corePaths = corePack.files.map(({ path }) => path);
    const cliPaths = cliPack.files.map(({ path }) => path);
    assert.equal(corePaths.includes("dist/index.js"), true);
    assert.equal(corePaths.includes("dist/index.d.ts"), true);
    assert.equal(
      corePaths.every(
        (path) =>
          path === "package.json" ||
          path.startsWith("dist/") ||
          path.startsWith("src/"),
      ),
      true,
    );
    assert.deepEqual(cliPaths.toSorted(), [
      "bin/mq.js",
      "dist/atomic-write.d.ts",
      "dist/atomic-write.d.ts.map",
      "dist/atomic-write.js",
      "dist/atomic-write.js.map",
      "dist/cli.d.ts",
      "dist/cli.d.ts.map",
      "dist/cli.js",
      "dist/cli.js.map",
      "package.json",
      "src/atomic-write.ts",
      "src/cli.ts",
    ]);

    for (const packed of [corePack, cliPack]) {
      for (const { path } of packed.files.filter(({ path: file }) =>
        file.endsWith(".map"),
      )) {
        const map = JSON.parse(tarText(packed.filename, path));
        if (Array.isArray(map.sourcesContent)) {
          assert.equal(map.sourcesContent.length, map.sources.length, path);
          assert.equal(
            map.sourcesContent.every((source) => typeof source === "string"),
            true,
            path,
          );
        } else {
          for (const source of map.sources) {
            const packagedSource = posix.normalize(
              posix.join(posix.dirname(path), map.sourceRoot ?? "", source),
            );
            assert.equal(
              packed.files.some(({ path: candidate }) => candidate === packagedSource),
              true,
              `${path} -> ${packagedSource}`,
            );
          }
        }
      }
    }
  });

  it("rewrites workspace dependencies and retains publish provenance metadata", () => {
    const core = JSON.parse(tarText(corePack.filename, "package.json"));
    const cli = JSON.parse(tarText(cliPack.filename, "package.json"));
    assert.deepEqual(core.exports, {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    });
    assert.deepEqual(core.publishConfig, { access: "public", provenance: true });
    assert.deepEqual(cli.publishConfig, { access: "public", provenance: true });
    assert.equal(cli.dependencies["@prelude/mq"], core.version);
    assert.equal(cli.bin.mq, "./bin/mq.js");
    assert.equal(cli.engines.node, ">=24.0.0");
  });

  it("installs, typechecks, imports, and executes outside the workspace", () => {
    const consumer = join(temporary, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "mq-artifact-consumer", private: true, type: "module" }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        corePack.filename,
        cliPack.filename,
      ],
      { cwd: consumer },
    );
    const source = [
      'import { parse, render, resourceLimits } from "@prelude/mq";',
      'const parsed = parse("# Packed\\n");',
      'if (!parsed.ok) throw new Error("parse failed");',
      'if (render(parsed.value) !== "# Packed\\n") throw new Error("render failed");',
      'if (resourceLimits.markdown.maxBytes <= 0) throw new Error("limits failed");',
    ].join("\n");
    writeFileSync(join(consumer, "consumer.ts"), source);
    writeFileSync(join(consumer, "consumer.mjs"), source);
    run(
      join(workspace, "node_modules", ".bin", "tsc"),
      [
        "--noEmit",
        "--strict",
        "--target",
        "ES2024",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "consumer.ts",
      ],
      { cwd: consumer },
    );
    run(process.execPath, ["consumer.mjs"], { cwd: consumer });

    const binary = join(consumer, "node_modules", ".bin", "mq");
    assert.notEqual(statSync(binary).mode & 0o111, 0, "installed mq must be executable");
    const cli = run(binary, ["--raw-output", 'select("heading") | text'], {
      cwd: consumer,
      input: "# Packed CLI\n",
    });
    assert.equal(cli.stdout, "Packed CLI\n");
    assert.equal(cli.stderr, "");

    cpSync(resolve(workspace, "examples"), join(consumer, "examples"), {
      recursive: true,
    });
    const commands = verifyWorkflowGuides({
      documentationRoot: resolve(workspace, "docs"),
      executionRoot: consumer,
      binaryDirectory: join(consumer, "node_modules", ".bin"),
    });
    assert.equal(commands.length > 0, true);
  });
});
