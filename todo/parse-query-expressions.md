---
name: Parse query expressions
description: Parse the initial expression language with precise diagnostics.
---

# Parse query expressions

Use `@prelude/parser` for `.`, `select`, `markdown`, `text`, `json`, `count`,
`first`, `last`, `array`, and pipelines. Reject trailing input and report ranges
within the expression source.

Acceptance: valid expressions compile once and invalid syntax never throws for
ordinary user input.
