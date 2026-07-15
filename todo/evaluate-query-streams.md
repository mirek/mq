---
name: Evaluate query streams
description: Execute compiled expressions as deterministic ordered value streams.
---

# Evaluate query streams

Define the runtime value model, pipeline fan-out, projections, reducers, and
stable JSON-compatible serialization. Preserve document and input order.

Acceptance: each initial expression has public API tests for zero, one, and many
values with deterministic output.
