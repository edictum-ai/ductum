---
date: 2026-05-03
status: accepted
deciders: Codex
related: 52, 135, 147, 151, 154
---

# Decision 155: P4 publishes one unscoped ductum package with bundled runtime assets

## Context

P4 turns the bootstrap redesign from a source-checkout flow into a global npm
install. The package needs the CLI, API server, dashboard assets, harness
adapters, MCP server, and workflow templates available from one `ductum`
binary. The public npm name `ductum` returned 404 during P4 prep, so the
unscoped name is available for the first publish.

The P4 contract also requires an explicit tarball allow-list, provenance, a
dry-run publish gate, and no package-owned install scripts.

## Decision

Publish `ductum@0.1.0` as a single package from `packages/ductum`.

The package owns:

- `bin.ductum = ./dist/bin/ductum.js`
- `files = ["dist", "assets", "README.md", "LICENSE"]`
- `publishConfig.access = "public"`
- `publishConfig.provenance = true`

`scripts/build-publish-package.mjs` copies compiled workspace output into
`packages/ductum/dist`, copies dashboard assets and workflow templates, writes
the cross-platform ESM bin wrapper, and rewrites internal static imports from
workspace package names to package-local relative imports. Dynamic API imports
of harness and MCP modules are driven by explicit file URL env vars instead of
bare `@ductum/*` package names.

The root package is renamed to `@ductum/monorepo` so the publishable package can
own the `ductum` name.

## Supply-chain notes

No new dependencies are added for P4. The publishable package repeats the
runtime dependencies already used by the monorepo and pins each version exactly.

`better-sqlite3` remains a runtime dependency because Ductum's local database is
SQLite-backed today. The published `ductum` manifest has no install scripts of
its own. The existing root `pnpm.onlyBuiltDependencies` allow-list already names
`better-sqlite3` for development installs; consumer npm installs may still run
the package's native install/build path. Pre-bundling native binaries or
replacing SQLite is outside P4 and would require a separate supply-chain
decision.

The intended release flow is:

- `pnpm pre-publish-gate` for the six structured pre-publish gates.
- `pnpm release:dryrun` as the operator-friendly dry run wrapper.
- `pnpm release:publish` only in the operator shell with a fresh `NPM_TOKEN`.

Codex does not run the irreversible real publish. D157 records the accepted
first-publish provenance drift: `ductum@0.1.0` is live, but npm could not
generate provenance from the local/private-repo first publish path.

## Consequences

The first package is intentionally larger than a CLI-only tarball because it
contains the API and dashboard runtime. The current compressed tarball is far
below the 30 MB P4 budget.

Future package splits (`@ductum/api`, `@ductum/dashboard`, plugin-specific
bundles) are separate decisions after P5 proves or disproves the redesigned
exit demo.
