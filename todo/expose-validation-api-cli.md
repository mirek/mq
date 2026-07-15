---
name: Expose validation API and CLI
description: Add public validation functions and the dedicated mq validate command.
---

# Expose validation API and CLI

Export typed `validate` behavior from `@prelude/mq` and adapt schema files,
diagnostic formats, and statuses in `mq validate` without duplicating rules.

Acceptance: JSON schema files and equivalent typed objects validate templates
consistently.
