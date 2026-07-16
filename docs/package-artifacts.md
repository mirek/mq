# Packed artifact verification

`pnpm check` builds and packs both publishable workspaces, then runs the same
artifact verifier used by CI's pinned Node 24 environment. Run it directly with:

```sh
pnpm test:artifacts
```

The verifier checks the tarball file allowlists, ESM/type export conditions,
`publishConfig` access and provenance fields, rewritten workspace dependency
versions, Node engine, and `mq` bin mapping. Every JavaScript source map embeds
its source; declaration-map sources resolve to packaged `src/` files.

It then creates a temporary project outside the workspace, installs only the two
tarballs, typechecks a strict NodeNext consumer, executes the ESM API, verifies
the installed binary has an executable mode, and runs a real stdin query. This
prevents passing builds from relying on workspace links, repository TypeScript
sources outside the package, or the root binary shim.
