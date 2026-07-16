# Remaining work

This index lists only work that remains, ordered by importance and dependency.
Todo files do not have statuses: when work is complete, delete its file and its
index entry instead of marking it completed. Keep descriptions to one line and
reorder the index whenever implementation evidence changes the priorities.

## Source-local edits

- [Implement edit operations](todo/implement-edit-operations.md) — Add replace, remove, insertion, title, and attribute operations.
- [Preserve immutable edits](todo/preserve-immutable-edits.md) — Return immutable edited snapshots equivalent to reparsing their rendered source.
- [Add CLI writes](todo/add-cli-writes.md) — Add explicit output and atomic in-place writing modes.
- [Verify write failure safety](todo/verify-write-failure-safety.md) — Inject failures to prove original files survive unsuccessful writes.

## Schemas

- [Load schemas strictly](todo/load-schemas-strictly.md) — Define the meta-schema and reject unknown or malformed schema input.
- [Implement schema rules](todo/implement-schema-rules.md) — Validate cardinality, content, attributes, children, ordering, and uniqueness.
- [Integrate frontmatter and JSON Schema](todo/integrate-frontmatter-json-schema.md) — Decode frontmatter and decide the JSON Schema integration boundary.
- [Format validation diagnostics](todo/format-validation-diagnostics.md) — Stabilize diagnostic codes, locations, ordering, and JSON output.
- [Expose validation API and CLI](todo/expose-validation-api-cli.md) — Add `validate` and the `mq validate` command.
- [Validate before writing](todo/validate-before-writing.md) — Prevent output and in-place writes when requested schema validation fails.

## Hardening and release

- [Fuzz language boundaries](todo/fuzz-language-boundaries.md) — Fuzz Markdown, edits, selectors, expressions, and schemas for crashes and invariant violations.
- [Benchmark resource limits](todo/benchmark-resource-limits.md) — Measure performance and document finite production defaults.
- [Verify package artifacts](todo/verify-package-artifacts.md) — Test exports, provenance, executable wiring, and clean installs from packed tarballs.
- [Automate releases](todo/automate-releases.md) — Add release CI and a generated changelog policy.
- [Ship executable examples](todo/ship-executable-examples.md) — Cover querying, modifying, creating, and validating in end-to-end fixtures.
- [Review public contracts](todo/review-public-contracts.md) — Review every public 0.x contract before the first release.
