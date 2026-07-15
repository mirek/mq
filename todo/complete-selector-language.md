---
name: Complete selector language
description: Implement the remaining selector operators, combinators, lists, and pseudos.
---

# Complete selector language

Add presence and comparison attributes, selector lists, adjacent/general sibling
combinators, and every pseudo specified in `SPEC.md`. Enforce typed comparisons
and bounded regular-expression behavior.

Acceptance: matches are deduplicated in source order and invalid use returns
stable diagnostics.
