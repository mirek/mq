---
name: Query core selectors
description: Compile and evaluate the smallest useful CSS-like selector subset.
---

# Query core selectors

Implement `document`, `section`, `heading`, universal and type selectors,
equality attributes, plus child and descendant combinators. Preserve source
order, remove duplicate matches, and return syntax/type failures as diagnostics.

Acceptance: the section-query example in `SPEC.md` works deterministically.
