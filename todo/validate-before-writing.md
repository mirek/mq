---
name: Validate before writing
description: Gate output and in-place mutation on requested schema validation.
---

# Validate before writing

Implement `--schema` for query/edit workflows and validate the resulting document
before any output path or original file is replaced.

Acceptance: invalid results cannot be written and original files remain intact.
