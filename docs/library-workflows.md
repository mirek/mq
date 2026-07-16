# Library workflows

These checked-in programs use only the public `@prelude/mq` package. Each reads
fixtures relative to its own file, so it can run from any working directory.

## Query a document

[`examples/query.mjs`](../examples/query.mjs) parses a guide, compiles one query
expression, and evaluates its level-two heading titles as an array:

```console
$ node examples/query.mjs
["Install","API"]
```

## Modify a document

[`examples/modify.mjs`](../examples/modify.mjs) compiles two selectors and
applies both edits as one immutable transaction. Rendering the result changes
only the selected paragraph and heading title:

```console
$ node examples/modify.mjs
# Guide
Overview.
## Install
Run `pnpm add @prelude/mq`.
## Library API
Use API.
```

## Create a document

[`examples/create.mjs`](../examples/create.mjs) turns portable JSON data into a
Markdown fragment and appends it to an empty parsed document through the same
edit transaction API:

```console
$ node examples/create.mjs
# mq 0.1.0

## Changes

- Query Markdown
- Validate structure
```

## Validate a document

[`examples/validate.mjs`](../examples/validate.mjs) validates the guide with the
strict JSON schema in [`examples/guide-schema.json`](../examples/guide-schema.json):

```console
$ node examples/validate.mjs
Guide is valid.
```

Every transcript in this guide and the CLI guides runs in CI twice: once from
the workspace and once from a temporary project containing only clean installs
of the packed library and CLI tarballs plus the checked-in example fixtures.
