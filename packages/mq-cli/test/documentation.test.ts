import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const workspace = fileURLToPath(new URL("../../..", import.meta.url));
const guidePaths = ["query-workflows.md", "validation-workflows.md"].map((name) =>
  join(workspace, "docs", name),
);
const transcripts = guidePaths.flatMap((path) =>
  Array.from(readFileSync(path, "utf8").matchAll(/```console\n([\s\S]*?)```/gu)),
);

describe("documented CLI workflows", () => {
  it("executes every console transcript with the installed workspace binary", () => {
    assert.ok(transcripts.length > 0);

    for (const transcript of transcripts) {
      const lines = transcript[1]!.trimEnd().split("\n");
      const prompt = lines.shift();
      assert.match(prompt ?? "", /^\$ /u);
      const command = prompt!.slice(2);
      const expected = `${lines.join("\n")}\n`;
      const result = spawnSync("/bin/sh", ["-c", command], {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          NO_COLOR: "1",
          PATH: `${join(workspace, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
        },
      });

      assert.equal(result.error, undefined, command);
      assert.equal(result.signal, null, command);
      assert.equal(result.status, 0, command);
      assert.equal(result.stderr, "", command);
      assert.equal(result.stdout, expected, command);
    }
  });
});
