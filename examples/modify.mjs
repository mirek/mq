import { readFile } from "node:fs/promises";

import {
  applyEdits,
  compileSelector,
  parse,
  parseMarkdownFragment,
  render,
  replaceEdit,
  setTitleEdit,
} from "@prelude/mq";

const value = (result) => {
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  return result.value;
};

const source = await readFile(new URL("./query-guide.md", import.meta.url), "utf8");
const document = value(parse(source, { path: "query-guide.md" }));
const installBody = value(
  compileSelector("section[title=Install] > paragraph"),
);
const apiSection = value(compileSelector("section[title=API]"));
const replacement = value(
  parseMarkdownFragment("Run `pnpm add @prelude/mq`."),
);
const edited = value(
  applyEdits(document, [
    replaceEdit(installBody, replacement),
    setTitleEdit(apiSection, "Library API"),
  ]),
);
process.stdout.write(render(edited));
