---
name: Verify lossless sections
description: Add fixtures and properties for lossless parsing and heading-derived nesting.
---

# Verify lossless sections

Cover BOMs, mixed newlines, missing final newlines, Unicode, malformed input,
opaque recovery, skipped ranks, and repeated ranks. Include generated inputs in
addition to readable fixtures.

Acceptance: arbitrary recoverable UTF-8 fixtures round-trip and all section
indexes satisfy the ownership rules in `SPEC.md`.
