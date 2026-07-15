---
name: Preserve immutable edits
description: Return immutable snapshots whose derived model equals a fresh parse.
---

# Preserve immutable edits

Apply patches without mutating prior documents and structurally share safe
indexes or source slices where practical. Rebuild identities only where ranges
are replaced.

Acceptance: rendering and reparsing each edit produces an equivalent document.
