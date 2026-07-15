---
name: Implement edit operations
description: Add the specified source-local node and attribute transformations.
---

# Implement edit operations

Implement replace, remove, append, prepend, before, after, title, and attribute
edits as composable patch planners. Detect detached or ambiguous targets.

Acceptance: every edit acceptance example changes only its planned ranges.
