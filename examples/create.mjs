import { readFile } from "node:fs/promises";

import {
  appendEdit,
  applyEdits,
  compileSelector,
  parse,
  parseMarkdownFragment,
  render,
} from "@prelude/mq";

const value = (result) => {
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  return result.value;
};

const release = JSON.parse(
  await readFile(new URL("./release.json", import.meta.url), "utf8"),
);
const markdown = [
  `# ${release.project} ${release.version}`,
  "",
  "## Changes",
  "",
  ...release.changes.map((change) => `- ${change}`),
  "",
].join("\n");
const empty = value(parse(""));
const document = value(compileSelector("document"));
const fragment = value(parseMarkdownFragment(markdown));
const created = value(applyEdits(empty, [appendEdit(document, fragment)]));
process.stdout.write(render(created));
