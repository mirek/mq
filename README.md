# mq

`mq` is intended to do for Markdown documents what `jq` does for JSON: make
structural queries and transformations easy from both shell pipelines and
programs.

The public package currently provides foundational document contracts, lossless
block recognition, heading-derived section trees, byte-identical rendering of
unchanged documents, CommonMark and GFM semantic views, compiled selectors, and
deterministic query expression streams. Selectors include typed comparisons,
lists, sibling combinators, structural/text/linear-regex pseudos, and relational
`:has`/`:not`. The read-only CLI supports stdin and file queries, raw and JSON
output, quiet and fail-empty modes, and human or JSON diagnostics. YAML, TOML,
and line-fenced JSON frontmatter and CommonMark reference definitions are
first-class query nodes. Editing and validation remain under implementation.

```ts
import {
  compileExpression,
  compileSelector,
  evaluate,
  parse,
  render,
  select,
} from "@prelude/mq";

const parsed = parse("# Guide\n## Installation\nRun the installer.\n");
const compiled = compileSelector("section[level=2]");
const expression = compileExpression('select("section[level=2]") | markdown');

if (parsed.ok && compiled.ok && expression.ok) {
  const sections = select(parsed.value, compiled.value);
  const markdown = evaluate(parsed.value, expression.value);
  console.log(sections, markdown, render(parsed.value));
}
```

See [Query workflows](docs/query-workflows.md) for executable examples covering
stdin, files, Markdown, text, JSON, collection, and error handling.

Read [SPEC.md](./SPEC.md) for the product and language design, then
[TODO.md](./TODO.md) for the prioritized remaining work.

## Workspace

- `@prelude/mq` — lossless document model, selectors, edits, and schemas
- `@prelude/mq-cli` — the `mq` executable

## Development

Requires Node.js 24 or newer and pnpm 11 or newer.

```sh
pnpm install
pnpm check
pnpm build
```

The workspace installs its own `mq` binary at `node_modules/.bin/mq` so the test
suite verifies the published library boundary and CLI adapter against the same
query fixtures.
