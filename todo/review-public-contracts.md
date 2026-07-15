---
name: Review public contracts
description: Review every public 0.x API, language, diagnostic, and package contract before release.
---

# Review public contracts

Audit names, immutability, errors, ranges, ordering, compatibility promises, and
deferred behavior. Remove accidental exports and resolve specification drift.

Acceptance: both packages install from tarballs in Node 24, all examples pass,
and remaining compatibility risks are documented before the first release.
