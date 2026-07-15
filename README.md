# mq

`mq` is intended to do for Markdown documents what `jq` does for JSON: make
structural queries and transformations easy from both shell pipelines and
programs.

The public package currently provides foundational document contracts, lossless
block recognition, heading-derived section trees, byte-identical rendering of
unchanged documents, and compiled core selectors. Expression queries, editing,
validation, and CLI behavior remain under implementation.

```ts
import { compileSelector, parse, render, select } from "@prelude/mq";

const parsed = parse("# Guide\n## Installation\nRun the installer.\n");
const compiled = compileSelector("section[level=2]");

if (parsed.ok && compiled.ok) {
  const sections = select(parsed.value, compiled.value);
  console.log(sections, render(parsed.value));
}
```

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
