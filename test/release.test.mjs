import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { verifyNpmVersion, verifyRelease } from "../scripts/verify-release.mjs";

const workspace = resolve(import.meta.dirname, "..");
const manifests = (version = "1.2.3") => [
  { version },
  {
    name: "@prelude/mq",
    version,
    repository: { url: "git+https://github.com/mirek/mq.git" },
    publishConfig: { access: "public", provenance: true },
  },
  {
    name: "@prelude/mq-cli",
    version,
    repository: { url: "git+https://github.com/mirek/mq.git" },
    publishConfig: { access: "public", provenance: true },
    dependencies: { "@prelude/mq": "workspace:*" },
  },
];

describe("release automation", () => {
  it("accepts one matching stable version and tag", () => {
    assert.deepEqual(verifyRelease("v1.2.3", manifests()), {
      tag: "v1.2.3",
      version: "1.2.3",
    });
  });

  it("rejects zero, prerelease, mismatched, and malformed releases", () => {
    assert.throws(() => verifyRelease("v0.0.0", manifests("0.0.0")));
    assert.throws(() => verifyRelease("v1.2.3-beta.1", manifests("1.2.3-beta.1")));
    assert.throws(() => verifyRelease("v1.2.4", manifests()));
    const mismatched = manifests();
    mismatched[2].version = "1.2.4";
    assert.throws(() => verifyRelease("v1.2.3", mismatched));
  });

  it("requires an npm client that supports trusted publishing", () => {
    assert.equal(verifyNpmVersion("11.5.1"), "11.5.1");
    assert.equal(verifyNpmVersion("12.0.0"), "12.0.0");
    assert.throws(() => verifyNpmVersion("11.5.0"));
    assert.throws(() => verifyNpmVersion("11.5.1-beta.0"));
  });

  it("pins least-privilege OIDC publishing and generated notes", () => {
    const workflow = readFileSync(
      resolve(workspace, ".github/workflows/release.yml"),
      "utf8",
    );
    const notes = readFileSync(resolve(workspace, ".github/release.yml"), "utf8");
    assert.match(workflow, /workflow_dispatch:/u);
    assert.match(workflow, /group: release-/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /environment: npm/u);
    assert.match(workflow, /package-manager-cache: false/u);
    assert.match(workflow, /verify-release\.mjs .*npm --version/u);
    assert.equal(workflow.match(/--dry-run/gu)?.length, 2);
    assert.equal(workflow.match(/npm view/gu)?.length, 2);
    assert.match(workflow, /npm publish .*prelude-mq-.*--access public/u);
    assert.match(workflow, /npm publish .*prelude-mq-cli-.*--access public/u);
    assert.ok(
      workflow.indexOf('npm publish "release-artifacts/prelude-mq-') <
        workflow.indexOf('npm publish "release-artifacts/prelude-mq-cli-'),
    );
    assert.match(workflow, /gh release create .*--generate-notes/u);
    assert.equal(workflow.includes("NODE_AUTH_TOKEN"), false);
    assert.match(notes, /skip-changelog/u);
    assert.match(notes, /labels: \["\*"\]/u);
  });
});
