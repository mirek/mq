# mq

`mq` does for Markdown what `jq` does for JSON: it queries documents by their
structure from shell pipelines or JavaScript programs while preserving their
original source.

## Installation

`mq` requires Node.js 24 or newer. Install the command globally with pnpm:

```sh
pnpm add --global @prelude/mq-cli
```

The installed executable is named `mq`. For the TypeScript and JavaScript API,
install the core package in your project instead:

```sh
pnpm add @prelude/mq
```

## Quick start

Print every heading as plain text:

```console
$ printf '# Guide\n## Install\nRun it.\n' | mq --raw-output 'select("heading") | text'
Guide
Install
```

Select a complete section as its exact Markdown source:

```console
$ printf '# Guide\n## Install\nRun it.\n' | mq 'select("section[title=Install]")'
## Install
Run it.
```

Count unchecked task-list items:

```console
$ printf '%s\n' '- [ ] write docs' '- [x] ship' | mq 'select("item[checked=false]") | count'
1
```

Run `mq --help` for input, output, validation, and atomic-write options. A query
is a pipeline expression; selectors are passed to `select("...")`. Selected
nodes render as exact Markdown by default, while `text` returns decoded text and
`--json` returns stable semantic JSON.

## Selectors

Selectors use CSS-like syntax over the Markdown tree. These node types are
available:

| Markdown area | Selectable types |
| --- | --- |
| Document structure | `document`, `section`, `heading` |
| Flow blocks | `frontmatter`, `paragraph`, `blank-line`, `blockquote`, `list`, `item`, `code`, `html`, `thematic-break`, `definition`, `opaque` |
| Tables | `table`, `row`, `cell` |
| Inline content | `text`, `emphasis`, `strong`, `strikethrough`, `inline-code`, `break`, `link`, `image` |

Attributes expose parsed metadata without matching raw Markdown spelling:

| Types | Available attributes |
| --- | --- |
| `document` | `path` |
| `section`, `heading` | `level`, `title`, `slug`; headings also have `style` |
| `frontmatter` | `format`, `value` |
| `list` | `ordered`, `start`, `tight` |
| `item` | `checked` |
| `code` | `language`, `meta`, `fenced`, `value` |
| `row`, `cell` | `header`; cells also have `alignment` |
| `link`, `image` | `destination`, `title`, `reference` |
| `definition` | `reference`, `label`, `destination`, `title` |
| `html`, `text`, `inline-code` | `value` |
| `opaque` | `reason` |

The complete selector syntax is:

| Feature | Examples |
| --- | --- |
| Type and universal selectors | `heading`, `code`, `*` |
| Attribute presence and equality | `[checked]`, `[level=2]`, `[title="Install"]` |
| Attribute comparisons | `!=`, `^=`, `$=`, `*=`, `~=`, `>`, `>=`, `<`, `<=` |
| Descendant and child combinators | `section code`, `section > paragraph` |
| Adjacent and general siblings | `heading + paragraph`, `heading ~ code` |
| Selector lists | `heading, code` |
| Structural pseudos | `:first-child`, `:last-child`, `:nth-child(2)` |
| Text and linear-regex pseudos | `:contains("install")`, `:matches(/todo/i)` |
| Relational pseudos | `section:has(> code)`, `item:not([checked=true])` |

Attribute and type names are case-insensitive; string values are
case-sensitive. Numeric and boolean values are unquoted. `:matches` supports
the RE2-compatible regular-expression subset with `i`, `m`, `s`, and `u` flags.
See [Selectors in the specification](SPEC.md#6-selectors) for exact comparison,
tree, escaping, limit, and diagnostic behavior.

## Library API

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

## More workflows

See [Query workflows](docs/query-workflows.md) for executable examples covering
stdin, files, Markdown, text, JSON, collection, and error handling.
See [Validation workflows](docs/validation-workflows.md) for schema files,
status behavior, and located rule notes.
See [Library workflows](docs/library-workflows.md) for executable querying,
modification, creation, and validation programs using the public package.

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
See [Packed artifact verification](docs/package-artifacts.md) for tarball
allowlists, provenance checks, and the isolated consumer test.
See [Releases](docs/releases.md) for lockstep versions, tag verification, OIDC
publishing order, provenance, and generated release notes.
See [Public 0.x contracts](docs/public-contracts.md) for the audited package
surfaces, behavioral guarantees, and remaining pre-1.0 compatibility risks.

The workspace installs its own `mq` binary at `node_modules/.bin/mq` so the test
suite verifies the published library boundary and CLI adapter against the same
query fixtures.
