---
name: Build query CLI
description: Adapt query evaluation to stdin, files, output modes, diagnostics, and exit statuses.
---

# Build query CLI

Keep argument parsing, filesystem access, streams, color policy, and process
status mapping in `@prelude/mq-cli`. Support raw, JSON, quiet, color, and
`--fail-empty` behavior across stdin and one or many files.

Acceptance: stdout, stderr, and statuses are stable for success and failure.
