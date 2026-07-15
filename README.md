# mq

`mq` is intended to do for Markdown documents what `jq` does for JSON: make
structural queries and transformations easy from both shell pipelines and
programs.

The public package currently provides foundational document contracts, lossless
block recognition, heading-derived section trees, and byte-identical rendering
of unchanged documents. Querying, editing, validation, and CLI behavior remain
under implementation.

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
