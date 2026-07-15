---
name: Load schemas strictly
description: Define a versioned meta-schema and strict loader for Markdown schemas.
---

# Load schemas strictly

Specify the portable JSON representation and equivalent TypeScript types. Reject
unknown keys, invalid selectors, malformed rules, and unsupported versions with
located diagnostics.

Acceptance: schema loading is deterministic and never silently ignores input.
