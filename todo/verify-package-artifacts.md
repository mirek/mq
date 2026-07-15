---
name: Verify package artifacts
description: Validate package exports, provenance metadata, executable wiring, and clean installs.
---

# Verify package artifacts

Pack both workspaces, inspect included files and source maps, then install them in
a clean Node 24 project. Verify ESM imports, declarations, and the `mq` binary.

Acceptance: packed tarballs work without relying on repository-only files.
