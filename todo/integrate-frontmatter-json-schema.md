---
name: Integrate frontmatter and JSON Schema
description: Decode frontmatter safely and decide the boundary for JSON Schema validation.
---

# Integrate frontmatter and JSON Schema

Define YAML/TOML/JSON decoding diagnostics and whether decoded values use an
external JSON Schema implementation or a documented mq subset. Record any new
runtime dependency and its maintenance rationale in `SPEC.md`.

Acceptance: malformed data is preserved and validation behavior is portable.
