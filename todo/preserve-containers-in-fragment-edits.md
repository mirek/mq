---
name: Preserve containers in fragment edits
description: Keep fragment edits on nested flow nodes inside their blockquote or list container.
---

# Preserve containers in fragment edits

Fragment operations currently use a target's absolute source boundary without
accounting for container prefixes. `beforeEdit` on a paragraph inside a
blockquote fails with `edit.fragment-boundary`, while `afterEdit` and multiline
`replaceEdit` can place generated lines outside the original blockquote or list.

Define the supported nested-target behavior in `SPEC.md`, reject unsupported
inline targets explicitly, and make supported block fragment edits preserve
their semantic container without rewriting unrelated source.

Acceptance: public API tests cover before, after, and multiline replacement in
blockquotes and list items with LF and CRLF input; successful edits reparse into
the intended container, round-trip losslessly, and change only the target range
plus required container-aware boundary text.
