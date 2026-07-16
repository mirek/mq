import { performance } from "node:perf_hooks";

import {
  applyEdits,
  compileSelector,
  loadSchema,
  MQ_SCHEMA_V1,
  parse,
  render,
  resourceLimits,
  select,
  setTitleEdit,
  validate,
} from "../packages/mq/dist/index.js";

const headingSelector = compileSelector("heading");
const schema = loadSchema({
  $schema: MQ_SCHEMA_V1,
  rules: [
    {
      selector: "heading",
      count: { min: 0 },
      text: { maxLength: 80 },
    },
  ],
});
if (!headingSelector.ok || !schema.ok) throw new Error("benchmark setup failed");

let sink;
const medianMilliseconds = (operation, iterations = 7) => {
  operation();
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    sink = operation();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return Number(samples[Math.floor(samples.length / 2)].toFixed(3));
};

const headings = (count) =>
  Array.from(
    { length: count },
    (_, index) => `${"#".repeat((index % 6) + 1)} Heading ${index}\nbody ${index}\n`,
  ).join("");

const benchmark = (name, source) => {
  const parsed = parse(source);
  if (!parsed.ok) throw new Error(`${name} did not parse`);
  const document = parsed.value;
  const edit = setTitleEdit(headingSelector.value, "Benchmarked");
  return {
    workload: name,
    bytes: Buffer.byteLength(source),
    parseMs: medianMilliseconds(() => parse(source)),
    selectMs: medianMilliseconds(() => select(document, headingSelector.value)),
    renderMs: medianMilliseconds(() => render(document)),
    editMs: medianMilliseconds(() => applyEdits(document, [edit])),
    validateMs: medianMilliseconds(() => validate(document, schema.value)),
  };
};

const rows = [
  benchmark("100 headings", headings(100)),
  benchmark("1,000 headings", headings(1_000)),
  benchmark("10,000 headings", headings(10_000)),
  benchmark("8 nested quotes", `${"> ".repeat(8)}deep\n# After\n`),
  benchmark("32 nested quotes", `${"> ".repeat(32)}deep\n# After\n`),
  benchmark("96 nested quotes", `${"> ".repeat(96)}deep\n# After\n`),
];

console.log(`Node ${process.version} ${process.platform}/${process.arch}`);
console.table(rows);
console.log("Finite defaults:", JSON.stringify(resourceLimits));
void sink;
