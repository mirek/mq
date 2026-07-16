import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";

const guideNames = Object.freeze([
  "query-workflows.md",
  "library-workflows.md",
  "validation-workflows.md",
]);

const transcriptsIn = (documentationRoot) =>
  guideNames.flatMap((name) =>
    Array.from(
      readFileSync(resolve(documentationRoot, name), "utf8").matchAll(
        /```console\n([\s\S]*?)```/gu,
      ),
    ),
  );

export const verifyWorkflowGuides = ({
  documentationRoot,
  executionRoot,
  binaryDirectory,
}) => {
  const commands = [];
  const transcripts = transcriptsIn(documentationRoot);
  if (transcripts.length === 0) throw new Error("workflow guides need console transcripts");

  for (const transcript of transcripts) {
    const lines = transcript[1].trimEnd().split("\n");
    const prompt = lines.shift();
    if (prompt === undefined || !prompt.startsWith("$ ")) {
      throw new Error("workflow transcript must begin with one shell prompt");
    }
    const command = prompt.slice(2);
    const expected = `${lines.join("\n")}\n`;
    const result = spawnSync("/bin/sh", ["-c", command], {
      cwd: executionRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        PATH: `${binaryDirectory}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
    if (result.error !== undefined) throw result.error;
    if (result.signal !== null || result.status !== 0) {
      throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
    }
    if (result.stderr !== "" || result.stdout !== expected) {
      throw new Error(
        `${command} output mismatch\nexpected: ${JSON.stringify(expected)}\nstdout: ${JSON.stringify(result.stdout)}\nstderr: ${JSON.stringify(result.stderr)}`,
      );
    }
    commands.push(command);
  }

  return Object.freeze(commands);
};
