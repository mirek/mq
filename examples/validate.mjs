import { readFile } from "node:fs/promises";

import { parse, validate } from "@prelude/mq";

const value = (result) => {
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  return result.value;
};

const source = await readFile(new URL("./query-guide.md", import.meta.url), "utf8");
const schema = await readFile(new URL("./guide-schema.json", import.meta.url), "utf8");
const document = value(parse(source, { path: "query-guide.md" }));
const valid = value(validate(document, schema, { path: "guide-schema.json" }));
process.stdout.write(`${valid.sections[0].title} is valid.\n`);
