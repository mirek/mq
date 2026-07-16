# Releases

`@prelude/mq` and `@prelude/mq-cli` are versioned and released together. Only
stable semantic versions are supported: every release uses the same non-zero
`X.Y.Z` version in the root and both package manifests and the exact tag
`vX.Y.Z`. Prerelease tags are rejected.

## Prepare a release

1. Update all three `version` fields in one pull request, update affected
   documentation and fixtures, and run `pnpm check`.
2. Merge the pull request to `main`.
3. Create an annotated or signed `vX.Y.Z` tag at that merge commit and push the
   tag. Never move or reuse a release tag.

The tag starts `.github/workflows/release.yml`. Its verification job checks the
tag and manifest metadata, npm trusted-publishing support, the complete test
suite, packed artifact policy, and both `npm publish --dry-run` operations. The
publish job runs only for a tag push, rebuilds and packs at the tagged commit,
publishes `@prelude/mq` before its dependent `@prelude/mq-cli`, and creates the
matching GitHub release only after both packages publish successfully.

To verify an existing tag without publishing, run the **Release** workflow
manually and supply the tag. Manual dispatch executes only the deterministic
verification job.

## Credentials and provenance

Configure an npm trusted publisher for each package with repository `mirek/mq`,
workflow `release.yml`, and GitHub environment `npm`. The workflow grants
`id-token: write` and `contents: write` only to the publishing job. It uses npm
OIDC rather than a long-lived registry token, requires an npm client that
supports trusted publishing, and keeps package-manager caching disabled for the
release jobs. Public package manifests enable npm provenance.

The `npm` GitHub environment may require approval for a final human gate. Its
deployment branch/tag rules must permit `v*.*.*` tags.

## Release notes

GitHub generates release notes from merged pull requests according to
`.github/release.yml`. Apply `breaking-change`, `enhancement`, `bug`,
`documentation`, `dependencies`, or internal-work labels to choose a section;
unmatched changes appear under **Other changes**. Use `skip-changelog` only for
changes that should not appear in user-facing notes. Release notes are generated
from repository history and are not maintained as a second changelog file.

Publishing the two packages is ordered but cannot be atomic because npm
versions are immutable. If the core publish succeeds and the CLI publish fails,
fix the external configuration or transient failure and rerun the tag workflow.
It detects the existing core version, skips it, and completes the same CLI
version before creating the GitHub release. Do not move the tag or increment
only one package.
