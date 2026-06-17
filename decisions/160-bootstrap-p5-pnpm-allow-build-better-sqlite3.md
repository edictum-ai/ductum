---
date: 2026-05-04
status: accepted
deciders: operator (Arnold Cartagena), Claude (Opus 4.7)
related: 109, 130, 131, 132, 135, 158, 159
---

# Decision 160: P5 second blocker — harness installs ductum with `--allow-build=better-sqlite3`

## Context

After D159 fixed the API startup guard to read
`~/.claude/.credentials.json`, the second clean-VM exit demo run
against `ductum@0.1.1` reached the `Scaffolded` step and the API
spawn — and then failed inside the API process loading
`better-sqlite3`:

```
Error: Cannot find module
  '/home/.../.pnpm/better-sqlite3@11.10.0/.../build/Release/better_sqlite3.node'
```

The native binding was not built. Verified by:

```
ls $HOME/.local/share/pnpm/global/5/.pnpm/better-sqlite3@*/.../build/Release/*.node
# (no such file)
```

`pnpm install -g ductum@0.1.1` printed the explanation:

```
WARN: Ignored build scripts: better-sqlite3@11.10.0.
Run "pnpm approve-builds -g" to pick which dependencies should be
allowed to run scripts.
```

This is pnpm 10's default security posture: install scripts of
transitive dependencies are blocked unless the project's
`pnpm.onlyBuiltDependencies` list allow-lists them, OR the install
command passes `--allow-build`.

Tested as a fix: adding `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`
to the *published* `ductum` package's manifest. Result: pnpm 10 does
**not** read that field from the package being globally installed.
The field only matters in the consuming project's manifest.

`npm install -g` runs scripts by default, so the npm path was never
broken by this. The harness defaults to `--install-tool pnpm` per
the protocol's documented command shape (D131 / P5).

## Decision

The exit demo harness (`scripts/demos/exit-demo-redo.mjs`) now passes
`--allow-build=better-sqlite3` when the install tool is pnpm. The
flag is conditional on `installTool === 'pnpm'` — npm path is
unchanged.

```ts
const installArgs = args.installTool === 'pnpm'
  ? ['install', '-g', '--allow-build=better-sqlite3', args.packageName]
  : ['install', '-g', args.packageName]
```

This keeps the demo's wall-clock honest: a real fresh-machine pnpm
user hits the exact same wall (the warning + native module not
built); the operator's choice to allow-list `better-sqlite3` is the
explicit decision they need to make to trust ductum's native dep.
The harness encodes that decision rather than masking it.

The published package's manifest stays unchanged — no
`pnpm.onlyBuiltDependencies` field added (it does not propagate from
the tarball), no version bump required. `ductum@0.1.1` remains the
demo target.

## Why this fix and not others considered

- **Add `pnpm.onlyBuiltDependencies` to the published package**:
  rejected. Verified empirically that pnpm 10 ignores this field in
  the package being globally installed. Would be cargo-cult code.
- **Switch to `npm install -g` in the harness**: rejected. P5 protocol
  documents the pnpm path. Switching the install tool changes what
  the demo proves.
- **Bundle the prebuilt `.node` binary in the published tarball**:
  rejected. better-sqlite3 ships platform-specific prebuilts via
  `prebuild-install`. Bundling a single platform's binary would limit
  the package; bundling all platforms inflates the tarball. Native
  builds at install time is the standard path.
- **Document a manual `pnpm approve-builds -g better-sqlite3` step
  before `pnpm install -g ductum`**: rejected. Adds a third operator
  action (browser_auth + approve_click + approve_builds), violating
  the protocol's "exactly two operator actions" pass criterion.

## How to apply

- Code change is in `scripts/demos/exit-demo-redo.mjs` only.
- No package republish needed.
- Re-run the P5 demo against `ductum@0.1.1` with the updated harness.
- The protocol's documented command remains
  `node scripts/demos/exit-demo-redo.mjs --json --package ductum@0.1.1`;
  the harness internalizes the `--allow-build` flag.

## Verification

- `pnpm test:scripts`: 38 tests pass (no script tests were touched by
  this change; install-args are an integration concern).
- Manual smoke against the same Lima VM:
  `pnpm install -g --allow-build=better-sqlite3 /tmp/ductum-0.1.2.tgz`
  produced a working binding at the expected path; `ductum --version`
  returned `0.1.2` cleanly.
- Live re-run pending; this decision lands before that re-run so the
  evidence captures the corrected harness.

## Non-goals

- Not changing the protocol's documented command shape.
- Not republishing the package — published 0.1.1 is correct as long
  as the install path passes `--allow-build`.
- Not solving the broader question of "should ductum publish a
  pure-JS sqlite alternative." That's a separate decision if the
  native dep ever becomes a friction beyond P5.

## Slop review

- Attack any future change that drops `--allow-build=better-sqlite3`
  from the pnpm install path without first documenting an
  alternative (e.g., a pure-JS sqlite swap).
- Attack any change that adds a third operator action to the demo
  protocol. Two clicks + browser_auth + approve_click is the
  contract.
- Attack any future native dep added to ductum that doesn't update
  this allow-list at the same time.
- Attack any future P5 demo that runs with `--install-tool npm` to
  bypass this allow-list. The demo's load-bearing claim is the pnpm
  global-install path.
