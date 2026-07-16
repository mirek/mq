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
first-class query nodes. Parsing and selector compilation use finite defaults
with lossless opaque recovery. Parser behavior is checked against all 652
CommonMark 0.31.2 examples and pinned GFM extension fixtures. The library also
exposes validated, non-overlapping source-patch plans and exact
retained/replacement source maps as its edit foundation. Lossless Markdown
fragments can be parsed and planned at LF, CRLF, or mixed-newline boundaries,
and composable planners cover replace/remove, before/after, prepend/append,
titles, ATX levels, and task checks. The library can apply a planned transaction
to a new immutable, reparsed document with an immediate source map; CLI writes
support explicit atomic output and in-place mode preservation. Schemas now have
a strict, versioned loader, portable YAML/TOML/JSON frontmatter decoding, and a
deterministic structural and JSON Schema rule engine with stable located
diagnostics. Both the public `validate` function and `mq validate` adapt the
same rules, and query `--schema` gates stdout and atomic writes before any
observable output.

```ts
import {
  compileExpression,
  compileSelector,
  evaluate,
  parse,
  render,
  select,
  validate,
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
See [Validation workflows](docs/validation-workflows.md) for schema files,
status behavior, and located rule notes.

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

See [Reproducible fuzz campaigns](docs/fuzzing.md) for the fixed seed, bounds,
invariants, and regression-retention workflow.
See [Performance and finite defaults](docs/performance.md) for the benchmark
command, dated baseline, exported limits, and their rationale.

The workspace installs its own `mq` binary at `node_modules/.bin/mq` so the test
suite verifies the published library boundary and CLI adapter against the same
query fixtures.
