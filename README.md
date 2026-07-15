# mq

`mq` is intended to do for Markdown documents what `jq` does for JSON: make
structural queries and transformations easy from both shell pipelines and
programs.

This repository currently contains the project scaffold and specification. It
does not yet provide a functional parser, API, or CLI.

Read [SPEC.md](./SPEC.md) for the product and language design, then
[PLAN.md](./PLAN.md) for the implementation sequence.

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
