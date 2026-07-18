---
name: Reject foreign nodes in context helpers
description: Reject Markdown nodes that do not belong to the document supplied for source projection.
---

# Reject foreign nodes in context helpers

`nodeMarkdown(document, node)` currently checks only whether the node's byte
offsets exist in the document. A node from another snapshot with compatible
offsets therefore returns an unrelated source slice. Source-dependent branches
of `toJsonValue(document, value)`, such as opaque-node JSON, have the same
context leak.

Validate node ownership by identity throughout nested arrays and objects before
using document source. Treat a foreign node as programmer misuse and preserve
the existing immutable behavior for locally owned values.

Acceptance: public API tests reject foreign nodes with both coincident and
different ranges in `nodeMarkdown` and `toJsonValue`, including nested and
opaque values, while nodes from the supplied document and its current edited
snapshot still project exact source.
