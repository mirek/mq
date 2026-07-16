# Query workflows

`mq` reads Markdown, evaluates one small pipeline expression, and writes the
resulting values. Start with `--help` when you need the command-line shape:

```console
$ mq --help
Usage: mq [options] [expression] [file ...]

Query Markdown documents as ordered value streams.

Arguments:
  expression                 Query expression (default: .)
  file ...                   Input files; omit for stdin, - also means stdin

Options:
  -r, --raw-output           Write strings without JSON quoting
  -j, --json                 Encode every result as canonical JSON
  -q, --quiet                Suppress results
  -n, --null-input           Evaluate one empty document without reading input
      --fail-empty           Exit 1 when an input emits no values
      --color <policy>       auto, always, or never (default: auto)
      --diagnostics <format> human or json (default: human)
  -h, --help                 Show this help
```

## Read stdin or files

With no file operands, `mq` reads one document from stdin. Use `--raw-output`
when a text projection should be shell-friendly instead of JSON-quoted:

```console
$ printf '# Guide\n' | mq --raw-output 'select("heading") | text'
Guide
```

For files, the first positional value is still the expression. Remaining paths
are evaluated independently and in the order supplied:

```console
$ mq --raw-output 'select("heading[level=1]") | text' examples/query-guide.md examples/query-reference.md
Guide
Reference
```

## Choose Markdown, text, or JSON

A selected node is Markdown by default. Selecting a section therefore keeps its
heading and body source exactly as written:

```console
$ mq 'select("section[title=Install]")' examples/query-guide.md
## Install
Run installer.
```

`text` emits strings. Without `--raw-output`, strings use compact JSON framing;
with it, each string is written directly with a trailing newline. `--json`
converts nodes themselves to the stable semantic JSON shape:

```console
$ mq --json 'select("heading[level=2]")' examples/query-guide.md
{"level":2,"style":"atx","title":"Install","type":"heading"}
{"level":2,"style":"atx","title":"API","type":"heading"}
```

## Collect or count a stream

Reducers consume the complete incoming stream. `array` always emits one array,
including when its input is empty; `count` similarly emits one number:

```console
$ mq 'select("heading[level=2]") | text | array' examples/query-guide.md
["Install","API"]
```

```console
$ mq 'select("heading") | count' examples/query-guide.md
3
```

## Handle empty results and errors

An empty stream normally succeeds. Add `--fail-empty` when absence should be a
shell-visible condition; it exits with status 1 and emits no data:

```console
$ mq --fail-empty 'select("heading[level=6]")' examples/query-guide.md; printf 'status=%s\n' "$?"
status=1
```

Expression and usage errors exit with status 2. JSON diagnostics are compact
objects on stderr, which is convenient for tools that need stable codes and
ranges:

```console
$ mq --diagnostics json wat </dev/null 2>&1; printf 'status=%s\n' "$?"
{"code":"expression.syntax","severity":"error","message":"Unknown expression stage \"wat\".","source":"expression","range":{"start":{"byteOffset":0,"line":1,"column":1,"utf16Column":1},"end":{"byteOffset":3,"line":1,"column":4,"utf16Column":4}}}
status=2
```

Filesystem failures exit with status 3. When several files are supplied, `mq`
continues in input order and returns the highest status encountered.
