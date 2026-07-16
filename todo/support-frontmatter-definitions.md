---
name: Support frontmatter and definitions
description: Recognize frontmatter and reference definitions as distinct lossless nodes.
---

# Support frontmatter and definitions

Recognize YAML, TOML, and JSON frontmatter only at valid document boundaries and
retain reference definitions with their concrete syntax. Decoding policy belongs
to the later schema task.

Extend the existing micromark/mdast adapter for recognized syntax while keeping
frontmatter boundary checks and mq-owned source ranges explicit.

Acceptance: selectors can distinguish formats and unchanged source round-trips.
