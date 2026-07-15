---
name: Fuzz language boundaries
description: Fuzz all parsers and edit application for crashes, hangs, and invariant violations.
---

# Fuzz language boundaries

Cover Markdown parse/render/edit, selector and expression compilation, and schema
loading. Retain minimal regressions for every discovered failure.

Acceptance: bounded campaigns preserve losslessness and source-locality invariants.
