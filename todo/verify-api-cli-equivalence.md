---
name: Verify API and CLI equivalence
description: Prove that the CLI is a thin adapter over public library behavior.
---

# Verify API and CLI equivalence

Run shared fixtures through the exported library functions and installed
workspace binary. Compare values, serialization, diagnostics, and ordering.

Acceptance: equivalent inputs and options produce equivalent observable results.
