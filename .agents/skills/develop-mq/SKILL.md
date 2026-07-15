---
name: develop-mq
description: Implement or change mq parser, selector, schema, mutation, library API, or CLI behavior. Use for any code task in the mirek/mq repository that must follow its specification, package boundaries, dependency policy, and lossless-edit invariants.
---

# Develop mq

1. Read the relevant parts of `SPEC.md`, `TODO.md`, and the selected task in
   `todo/`.
2. Identify one observable vertical slice; avoid speculative package splits or
   abstractions outside that slice.
3. Add a failing test with `node:test` through the public API or CLI boundary.
4. Implement the smallest composable change that passes it.
5. Add round-trip and source-locality cases whenever parsing or rendering is
   involved.
6. Run `pnpm check` and `pnpm build` from the workspace root.
7. Update `SPEC.md` when behavior changes. Delete completed task files and their
   `TODO.md` entries; never mark a todo completed.

Keep filesystem and process concerns in `@prelude/mq-cli`. Keep the core package
deterministic and side-effect free. Prefer Node built-ins and `@prelude/*`
packages; justify other runtime dependencies.
