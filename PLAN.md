# Implementation plan

This plan sequences vertical slices. Each milestone should land as a reviewable
pull request with tests, documentation, and no unused framework for later work.
If implementation evidence contradicts `SPEC.md`, update the specification in
the same pull request rather than silently diverging.

## Milestone 1 — lossless sections

Deliver the smallest useful library slice:

1. block recognition for BOM/newlines, ATX and Setext headings, paragraphs,
   blank lines, and opaque fallback blocks;
2. stack-based section derivation, including skipped and repeated ranks;
3. byte-identical render for unchanged documents;
4. `compileSelector` and `select` for `document`, `section`, `heading`, type,
   child/descendant combinators, and equality attributes;
5. public parsing and querying exports from `@prelude/mq`;
6. fixtures and property tests for round-trip and heading nesting.

Exit criterion: the section-query acceptance example works through the public
library API, and arbitrary recoverable UTF-8 fixtures round-trip exactly.

## Milestone 2 — query CLI

1. expression parser for `.`, `select`, `markdown`, `text`, `json`, `count`,
   `first`, `last`, `array`, and pipelines;
2. evaluation streams and deterministic value serialization;
3. CLI stdin/file handling, raw/JSON/quiet output, colors, and exit statuses;
4. public API/CLI equivalence fixtures;
5. help text and end-user examples.

Exit criterion: installed workspace binary queries one or many Markdown files
without mutation and produces stable stdout, stderr, and statuses.

## Milestone 3 — complete block model and selectors

1. CommonMark blocks and inline views;
2. GFM tables, task items, strikethrough, and autolinks;
3. frontmatter and reference definitions;
4. remaining attribute operators, sibling combinators, and pseudos;
5. opaque recovery and resource limits;
6. CommonMark/GFM conformance corpus plus mq losslessness fixtures.

Exit criterion: supported CommonMark/GFM fixtures expose the specified derived
nodes, unsupported extensions remain byte-identical, and selector complexity
limits handle adversarial input.

## Milestone 4 — source-local edits

1. patch representation, overlap detection, and source-map updates;
2. fragment parsing and boundary-newline planning;
3. replace, remove, append, prepend, before, after, title, and attribute edits;
4. immutable edited snapshots and reparsing equivalence tests;
5. CLI `--write`, `--output`, `--null-input`, and atomic file replacement;
6. failure-injection tests proving originals survive write failures.

Exit criterion: all edit acceptance examples pass, and property tests show that
bytes outside planned patch ranges do not change.

## Milestone 5 — schemas

1. schema meta-schema and strict loader;
2. cardinality, text, Markdown, attribute, child, order, and uniqueness rules;
3. decoded frontmatter plus JSON Schema integration decision;
4. deterministic diagnostic codes, locations, and JSON formatting;
5. `validate` API and `mq validate` command;
6. `--schema` validation before output or in-place writes.

Exit criterion: template validation works through JSON schema files and typed
objects, and invalid results cannot be written when validation is requested.

## Milestone 6 — hardening and first release

1. fuzz parse/render/edit and selector/expression/schema parsers;
2. performance benchmarks and documented finite defaults;
3. package export, provenance, executable, and clean-install verification;
4. CI release workflow and generated changelog policy;
5. end-to-end examples for querying, modifying, creating, and validating files;
6. compatibility review of every public 0.x contract.

Exit criterion: both packages can be installed from packed tarballs in a clean
Node 24 project, the CLI passes end-to-end tests, and the documented examples are
executable fixtures.

## Cross-cutting rules

- Begin every behavior change with a failing `node:test` case.
- Prefer public-boundary tests; use internal unit tests only for combinatorial
  algorithms that would be hard to diagnose through the public API.
- Keep benchmark thresholds informative until CI runners provide stable data.
- Do not extract a third workspace package without an actual independent
  dependency or consumer.
- Prefer `@prelude/*` dependencies and Node built-ins; document exceptions.
- Update specification examples whenever syntax or semantics change.
