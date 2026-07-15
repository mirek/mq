# mq

`mq` is intended to do for Markdown documents what `jq` does for JSON: make
structural queries and transformations easy from both shell pipelines and
programs.

The public package currently provides foundational document contracts and
lossless block recognition for source metadata, headings, paragraphs, blank
lines, and opaque fallback blocks. Section derivation, rendering, querying,
editing, validation, and CLI behavior remain under implementation.

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
