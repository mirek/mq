---
name: Expose query API
description: Publish a coherent first library surface for rendering, compiling, and selecting.
---

# Expose query API

Export `render`, `compileSelector`, `select`, their option and compiled types,
and structured results from `@prelude/mq`. Keep internal indexes private unless
they are part of the documented public contract.

Acceptance: a clean consumer can execute the TypeScript query example in
`SPEC.md`.
