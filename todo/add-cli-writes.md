---
name: Add CLI writes
description: Add explicit output and atomic in-place write modes to the CLI.
---

# Add CLI writes

Implement `--write`, `--output`, and `--null-input` with input-count checks,
temporary files, atomic replacement, and file-mode preservation. Queries remain
non-mutating unless a write option is explicit.

Acceptance: successful writes produce exactly the library-rendered bytes.
