---
name: Parse edit fragments
description: Parse replacement fragments and plan context-aware boundary newlines.
---

# Parse edit fragments

Reuse Markdown parsing for inserted fragments and define newline behavior at
document, block, and section boundaries without reformatting adjacent source.

Acceptance: LF, CRLF, mixed-newline, first/last-node, and empty-fragment cases are
deterministic.
