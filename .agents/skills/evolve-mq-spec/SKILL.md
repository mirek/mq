---
name: evolve-mq-spec
description: Design, review, or revise mq syntax and semantics in SPEC.md. Use when deciding Markdown tree behavior, selectors, query expressions, edits, schemas, diagnostics, CLI behavior, compatibility, or implementation sequencing before or alongside code changes.
---

# Evolve the mq specification

1. Start from user-visible examples and failure cases.
2. Check the proposal against the lossless round-trip, source-local edit,
   deterministic selection, and library/CLI parity invariants in `SPEC.md`.
3. Prefer one orthogonal primitive over multiple special cases.
4. Specify syntax, semantics, diagnostics, and edge cases together.
5. Mark deferred behavior explicitly; do not leave normative behavior ambiguous.
6. Update conformance examples and `PLAN.md` when a decision changes delivery.

Preserve the distinction between the concrete syntax tree and the derived
section tree. Treat heading-derived hierarchy as a view over source Markdown,
not as permission to normalize unrelated text.
