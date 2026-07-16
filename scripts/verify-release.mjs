import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const minimumTrustedPublishingNpm = Object.freeze([11, 5, 1]);

export const verifyNpmVersion = (version) => {
  if (typeof version !== "string" || !stableVersion.test(version)) {
    throw new Error("npm version must be a stable semantic version");
  }
  const actual = version.split(".").map(Number);
  for (let index = 0; index < minimumTrustedPublishingNpm.length; index += 1) {
    if (actual[index] > minimumTrustedPublishingNpm[index]) return version;
    if (actual[index] < minimumTrustedPublishingNpm[index]) {
      throw new Error("trusted publishing requires npm 11.5.1 or newer");
    }
  }
  return version;
};

export const verifyRelease = (tag, manifests) => {
  const [workspace, core, cli] = manifests;
  const version = workspace?.version;
  if (typeof version !== "string" || !stableVersion.test(version) || version === "0.0.0") {
    throw new Error("release version must be a non-zero stable semantic version");
  }
  if (core?.version !== version || cli?.version !== version) {
    throw new Error("workspace and package versions must match");
  }
  if (tag !== `v${version}`) {
    throw new Error(`tag ${JSON.stringify(tag)} must equal v${version}`);
  }
  if (core.name !== "@prelude/mq" || cli.name !== "@prelude/mq-cli") {
    throw new Error("unexpected publishable package names");
  }
  for (const manifest of [core, cli]) {
    if (manifest.private === true) throw new Error(`${manifest.name} must be public`);
    if (
      manifest.publishConfig?.access !== "public" ||
      manifest.publishConfig?.provenance !== true
    ) {
      throw new Error(`${manifest.name} must enable public provenance publishing`);
    }
    if (manifest.repository?.url !== "git+https://github.com/mirek/mq.git") {
      throw new Error(`${manifest.name} repository must match the trusted publisher`);
    }
  }
  if (cli.dependencies?.["@prelude/mq"] !== "workspace:*") {
    throw new Error("CLI must retain its workspace dependency before packing");
  }
  return Object.freeze({ tag, version });
};

const main = () => {
  verifyNpmVersion(process.argv[3]);
  const metadata = verifyRelease(process.argv[2], [
    JSON.parse(readFileSync("package.json", "utf8")),
    JSON.parse(readFileSync("packages/mq/package.json", "utf8")),
    JSON.parse(readFileSync("packages/mq-cli/package.json", "utf8")),
  ]);
  process.stdout.write(`tag=${metadata.tag}\nversion=${metadata.version}\n`);
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
