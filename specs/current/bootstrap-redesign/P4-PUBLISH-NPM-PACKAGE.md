# P4 — Publish `ductum` as an npm Package

## Problem

After P0-P3 ship, the factory installs from this monorepo via
`pnpm install` from inside the cloned repo. End users still need to
`git clone`. The arc's claim — "install the tool, run it from
anywhere" — requires `pnpm install -g ductum` (or `npm install -g
ductum`) to actually work.

This stage publishes the CLI package to the public npm registry,
named `ductum`, with the API + dashboard bundled inside so a global
install gives the operator a complete factory binary.

## Scope

scripts/release + a publish-shaped reorganization of `packages/cli`:

- `packages/cli/package.json` renamed (or aliased) to `"name":
  "ductum"`. `"bin": { "ductum": "./dist/index.js" }`.
- The published package bundles the compiled API server and the
  built dashboard. Verify shape: a `pnpm install -g ductum` user
  needs zero workspace context to run `ductum start`.
- `pnpm pack` shape verified with `npm publish --dry-run`. Tarball
  size budget: < 30 MB compressed. If exceeded, audit what's
  bundled and split (e.g., dashboard assets become a peer fetch
  or a separate `@ductum/dashboard-assets` package).
- `scripts/release.mjs` (new) — version bump, changelog,
  `npm publish --provenance` with `--access public`.
- `.npmignore` (new) — excludes tests, fixtures, decisions/, specs/,
  source maps if not needed at runtime.
- README.md (top-level published `README` for the npm page) — points
  at hosted docs and `ductum init`.

Does **not** add:

- A separate `@ductum/api`, `@ductum/dashboard` published package.
  P4 publishes one binary; later splits are their own decisions.
- Auto-update notification on installed CLI.
- Signed/notarized macOS binaries — npm package only.

## Behavior Contract

### 4.1 Package shape

- Name: `ductum`
- Initial version: `0.1.0` (first public publish; the monorepo's
  internal versions stay decoupled from the published package).
  Verify there's no existing squatted name on npm at implementation
  time; if `ductum` is taken, decide a fallback name as a recorded
  decision before publishing.
- License: MIT (matches repo `LICENSE`).
- `engines.node`: `>=22` (matches monorepo's Node 22+ requirement).
- `bin.ductum`: `./dist/index.js`.
- `provenance: true` enabled in publish flow.
- `publishConfig.access`: `public`.

### 4.2 What ships in the tarball

Required:
- `dist/` (compiled CLI + API + dashboard)
- `README.md`
- `LICENSE`
- `package.json`
- Bundled sample spec(s) for `ductum init`'s welcome import
  (P3.3) → `assets/specs/examples/hello-readme/`.

Excluded:
- `src/` (TypeScript source — only compiled JS ships)
- `tests/`, `*.test.*`
- `decisions/`, `specs/`, `evidence/`, `docs/` (project docs stay in
  the repo, hosted docs stay on the docs site)
- `*.map` source maps (debate at impl time; default exclude).

### 4.3 Release script

- `pnpm release:dryrun` runs `pnpm build` + `pnpm test` + `npm pack`
  and prints the tarball contents and size. Operator-runnable, no
  publish.
- `pnpm release:publish` runs the dryrun checks then
  `npm publish --provenance --access public`. Requires
  `NPM_TOKEN` in env. Aborts if uncommitted changes, if not on
  `main`, if any test failed, if tarball exceeds 30 MB.

### 4.4 Supply-chain rules

- The published package itself cannot enable `postinstall` or any
  install scripts. Verify by inspecting the published `package.json`
  with `npm pack` before publish.
- `pnpm-lock.yaml` is committed and is the source of truth for the
  development install. The published tarball pins exact runtime deps
  in its own `package.json`.
- Pre-publish, audit any new transitive dep introduced by the
  bundling step. If anything new appears, run the D52 audit.

### 4.5 D135 contract conformance

- `ductum --version` prints version per envelope when `--json`.
- `ductum doctor` (existing) reports the published version vs
  installed version when self-update detection kicks in. (Self-update
  is out of scope; only the version surfacing belongs in this stage.)

## Verification

- `pnpm release:dryrun` passes.
- A test publish to a private registry (Verdaccio in CI, or a
  scratch namespace) before the public publish. The test must
  install the package globally, run `ductum init` against a
  scratch dir, and reach P0's exit demo without the source repo
  cloned.
- File-size gate green (release script ≤200 LOC).
- All existing tests still green.

## Exit Demo

Recorded as evidence in `evidence/p4-publish-demo.txt`.

On a fresh machine without this repo cloned:

```sh
# Real npm publish:
pnpm release:publish   # operator runs, with fresh NPM token

# Then on a clean machine:
pnpm install -g ductum
which ductum
ductum --version
ductum init   # walks P0-P3 demo end-to-end against published package
```

The published package must run end-to-end via `ductum init` and
reach the dashboard `/welcome` route in a browser, *with the source
repo never cloned on the demo machine*. This is the precondition
for P5's exit demo.

## Drift Handling

- `ductum` name squatted on npm → record alternative name in a
  decision (e.g., `@edictum/ductum`, `ductum-cli`). Update repo refs
  consistently.
- Tarball exceeds 30 MB and split is needed → record decision; split
  dashboard into a peer-fetched `@ductum/dashboard-assets`. Don't
  silently accept a fat package.
- npm provenance setup blocks publish → decide whether to ship
  without provenance (with explicit risk-acknowledgment in the
  decision) or block publish until provenance is set up.

## Slop Review

- Attack any publish that uses the 2026-05-03 npm token. It expired.
  Operator must regenerate; the regeneration step is part of the
  exit demo evidence.
- Attack any publish without `--provenance`.
- Attack any publish from a dirty working tree, a non-`main` branch,
  or with failing tests.
- Attack a published tarball that includes `tests/`, `decisions/`,
  `specs/`, or any source maps.
- Attack a published `package.json` with non-pinned dep ranges.
  Exact pins per D52.
- Attack any postinstall script appearing in the published manifest.
- Attack a `ductum start` from the global install that needs a
  monorepo workspace to function (defeats the whole arc).
- Attack any change here that touches `scripts/bootstrap.mjs`.
  (D150: legacy stays legacy.)
