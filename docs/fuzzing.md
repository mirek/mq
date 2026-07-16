# Reproducible fuzz campaigns

The core test suite includes fixed-seed, bounded language campaigns in
`packages/mq/test/fuzz.test.ts`. Run them directly with:

```sh
node --test packages/mq/test/fuzz.test.ts
```

Seed `0x6d71f022` drives 512 Markdown/edit cases and 1,024 selector,
expression, and schema cases. Failure messages include the case number, so a
failure reproduces without retaining random process state.

The Markdown campaign requires byte-identical parse/render round trips. It
applies generated heading-title edits, proves rejected edits leave the original
snapshot unchanged, reparses successful edits, and compares every retained
source-map byte range. The language campaign feeds both arbitrary syntax and
structured JSON into selector, expression, and schema boundaries; accepted
programs are executed against a fixed document, while ordinary invalid input
must remain bounded failure data.

Each campaign has a 15-second test timeout. When a campaign finds a defect,
reduce the failing case to the smallest readable fixture, add it beside the
campaign before fixing the implementation, and keep the fixed seed unchanged.
