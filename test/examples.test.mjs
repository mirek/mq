import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { verifyWorkflowGuides } from "../scripts/verify-workflow-guides.mjs";

const workspace = resolve(import.meta.dirname, "..");
const expectedExamples = ["create.mjs", "modify.mjs", "query.mjs", "validate.mjs"];

describe("executable workflow examples", () => {
  it("documents and runs every checked-in workflow", () => {
    assert.deepEqual(
      readdirSync(resolve(workspace, "examples"))
        .filter((path) => path.endsWith(".mjs"))
        .toSorted(),
      expectedExamples,
    );

    const commands = verifyWorkflowGuides({
      documentationRoot: resolve(workspace, "docs"),
      executionRoot: workspace,
      binaryDirectory: resolve(workspace, "node_modules/.bin"),
    });
    for (const example of expectedExamples) {
      assert.equal(
        commands.some((command) => command.includes(`examples/${example}`)),
        true,
        `${example} must be documented and executed`,
      );
    }
  });
});
