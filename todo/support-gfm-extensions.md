---
name: Support GFM extensions
description: Add lossless GFM tables, task items, strikethrough, and autolinks.
---

# Support GFM extensions

Represent the GFM forms and their selector attributes without normalizing source
spelling. Preserve malformed or unsupported extensions as opaque source.

Extend the existing micromark/mdast semantic adapter rather than introducing a
second parser or changing mq's retained-source and range ownership.

Acceptance: representative GFM fixtures expose the specified derived nodes and
round-trip byte-for-byte.
