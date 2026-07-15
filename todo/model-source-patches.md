---
name: Model source patches
description: Represent deterministic non-overlapping edits against original source ranges.
---

# Model source patches

Define patch ordering, overlap and ambiguity errors, application, and source-map
updates. Reject conflicting operations before producing output.

Acceptance: property tests prove bytes outside planned ranges never change.
