---
name: Build query CLI
description: Adapt query evaluation to stdin, files, output modes, diagnostics, and exit statuses.
---

# Build query CLI

Keep argument parsing, filesystem access, streams, color policy, and process
status mapping in `@prelude/mq-cli`. Support raw, JSON, quiet, color, and
`--fail-empty` behavior across stdin and one or many files.

Delegate expression compilation and evaluation to `@prelude/mq`; preserve its
query-value ordering and canonical JSON representation rather than rebuilding
either contract in the CLI package.

Acceptance: stdout, stderr, and statuses are stable for success and failure.
