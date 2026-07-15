---
name: Run Markdown conformance
description: Validate supported CommonMark and GFM behavior against upstream corpora and mq invariants.
---

# Run Markdown conformance

Integrate pinned CommonMark/GFM examples plus mq-specific losslessness fixtures.
Record intentional deviations and keep unsupported extensions opaque.

Acceptance: supported fixtures expose the specified nodes, all recoverable input
round-trips, and complexity limits handle adversarial cases.
