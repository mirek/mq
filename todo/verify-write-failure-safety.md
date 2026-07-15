---
name: Verify write failure safety
description: Prove failed output operations cannot damage original files.
---

# Verify write failure safety

Inject open, write, flush, rename, validation, and permission failures around the
atomic write workflow. Clean up temporary files without hiding primary errors.

Acceptance: originals survive every injected failure byte-for-byte.
