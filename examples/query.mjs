import { readFile } from "node:fs/promises";

import { compileExpression, evaluate, parse } from "@prelude/mq";

const value = (result) => {
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  return result.value;
};

const source = await readFile(new URL("./query-guide.md", import.meta.url), "utf8");
const document = value(parse(source, { path: "query-guide.md" }));
const expression = value(
  compileExpression('select("heading[level=2]") | text | array'),
);
process.stdout.write(`${JSON.stringify(evaluate(document, expression)[0])}\n`);
