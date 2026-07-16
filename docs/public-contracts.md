# Public 0.x contracts

This is the pre-release audit baseline for the two publishable packages. The
exact runtime and TypeScript export snapshots are executable checks in
`test/artifacts.test.mjs` and `test/public-contracts.test.mjs`; adding, removing,
or renaming an export therefore requires an intentional review.

## Package surfaces

`@prelude/mq` is native ESM with one public root entry. Its public runtime
values fall into these complete groups:

- parsing and source: `parse`, `render`, `inlines`, `sourcePosition`, and
  `sourceRange`;
- selectors and expressions: `compileSelector`, `select`, `compileExpression`,
  `evaluate`, `isMarkdownNode`, `nodeMarkdown`, and `toJsonValue`;
- edits: `replaceEdit`, `removeEdit`, `beforeEdit`, `afterEdit`, `prependEdit`,
  `appendEdit`, `setTitleEdit`, `setAttributeEdit`, `planEdits`, `applyEdits`,
  `parseMarkdownFragment`, `planFragmentInsertion`, `planSourcePatches`, and
  `applySourcePatches`;
- schemas: `MQ_SCHEMA_V1`, `schemaMetaSchemaV1`, `loadSchema`, and `validate`;
- shared contracts: `success`, `failure`, and `resourceLimits`.

The root declaration exports the corresponding document, CST, query, edit,
schema, result, source, source-map, option, and diagnostic types. Internal
modules remain package implementation and source/declaration-map targets;
package exports block their use as public subpaths.

`@prelude/mq-cli` is executable-only. Its sole public surface is the `mq` binary
and its documented arguments, streams, diagnostics, and exit statuses. The
package has an empty JavaScript export map, so `dist/` and `src/` implementation
files cannot become accidental deep-import contracts.

Both packages require Node 24 or newer, are versioned in lockstep, publish as
public ESM packages with provenance, and are tested after installation from
their packed tarballs. The CLI package retains `@prelude/mq` as its only runtime
workspace dependency.

## Behavioral guarantees

- Public models, results, diagnostics, compiled languages, collections, schema
  data, plans, source maps, and limits are readonly and frozen. An edit no-op
  preserves the complete document identity; a non-empty edit creates a new
  immutable snapshot and new node identities.
- Source ranges are half-open UTF-8 byte ranges with one-based Unicode
  code-point columns and one-based UTF-16 columns. Invalid or foreign patch
  coordinates fail before output is produced.
- Ordinary parse, language, edit, and schema input errors are `Result` data.
  Programmer misuse of opaque compiled values or plans may throw.
- Selectors, expression streams, patches, diagnostics, notes, files, and CLI
  output retain the ordering specified in `SPEC.md`. No adapter may silently
  resort them.
- Diagnostic codes are stable within a major version. Human messages may
  improve in minor versions. CLI status meanings are stable public behavior.
- Unchanged rendering is byte-identical. Edits alter only planned source ranges
  and required fragment-boundary text.

These guarantees are covered across the model, selector, expression, edit,
schema, API/CLI-equivalence, package-artifact, and executable-example suites.

## Remaining pre-1.0 compatibility risks

Semantic versioning permits public changes in 0.x minor releases, with release
notes and updated fixtures. In particular:

- adding a node variant can break exhaustive TypeScript switches even when the
  new parser behavior preserves previously opaque source;
- selector attributes, slug behavior, semantic JSON shapes, resource-limit
  defaults, and diagnostic wording may be refined before 1.0; the exact current
  behavior remains tested and any change requires release notes;
- the query expression grammar intentionally has no edit transactions. Future
  expression or CLI edit syntax needs an explicit compatibility design;
- move/copy semantics, browser and WASM packaging, plugin contracts, and
  multi-document framing remain deferred;
- only UTF-8 input is guaranteed, and HTML rendering is outside scope.

The schema identifier isolates schema-language compatibility. After 1.0, the
major-version rules in `SPEC.md` additionally protect root exports and types,
coordinates, readonly/result contracts, tree and selector semantics, edit
conflicts, diagnostic codes, CLI status meanings, and schema behavior.
