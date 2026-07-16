# Validation workflows

`mq validate` loads one strict mq schema, validates each Markdown input in
order, writes no data, and uses its status for automation:

```console
$ mq validate --schema examples/guide-schema.json examples/query-guide.md; printf 'status=%s\n' "$?"
status=0
```

Violations exit with status 1. Human diagnostics point to the Markdown failure
and then the schema rule that produced it:

```console
$ mq validate --schema examples/guide-schema.json examples/query-reference.md 2>&1; printf 'status=%s\n' "$?"
examples/query-reference.md:1:1: error[schema.text-enum]: Plain text "Reference" is not one of ["Guide"].
examples/guide-schema.json:5:5: note: Schema rule 1 is defined here.
examples/query-reference.md:1:1: error[schema.count]: Expected at least 2 matches; found 0.
examples/guide-schema.json:10:5: note: Schema rule 2 is defined here.
status=1
```

Omit files to validate stdin. `--diagnostics=json` emits the same ordered
diagnostic objects, including notes, as compact JSON lines.
