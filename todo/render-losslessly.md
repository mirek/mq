---
name: Render losslessly
description: Render unchanged documents by preserving their original Markdown bytes exactly.
---

# Render losslessly

Implement `render` from retained source and concrete ranges without normalizing
BOMs, newline styles, whitespace, heading spelling, or opaque blocks.

Acceptance: every recoverable input accepted by `parse` returns byte-identical
output when no edit has been applied.
