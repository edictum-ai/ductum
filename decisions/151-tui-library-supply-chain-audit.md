---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena)
related: 52, 147, 148, 149
---

# Decision 151: Supply-chain audit — `@clack/prompts` and `open`

## Context

The bootstrap-redesign arc adds two new runtime dependencies to
`@ductum/cli`:

- `@clack/prompts` (chosen in D148) for the TUI primitives.
- `open` (chosen in D149) for browser auto-open.

Per D52 and the repo's `SECURITY.md`, every new dependency requires
license verification, publish-cadence sanity, exact pinning, and an
integrity hash captured at decision time.

This decision is the audit. It is the canonical pin for both packages
through this arc.

## Audit findings (2026-05-03)

All metadata pulled from the public npm registry on 2026-05-03.

### `@clack/prompts`

- **Latest published**: `1.3.0` on 2026-04-29 (4 days old at audit
  time; **fails the 7-day buffer**).
- **Previous stable**: `1.2.0` on 2026-03-31 (33 days old; passes the
  buffer).
- **Pinned for this arc**: `1.2.0`.
- **License**: MIT.
- **Repository**: `git+https://github.com/bombshell-dev/clack.git`.
- **Engines**: not declared on 1.2.0 (1.3.0 added `node >= 20.12.0`;
  Ductum requires Node 22+ so either version is satisfied).
- **Integrity** (1.2.0): `sha512-4jmztR9fMqPMjz6H/UZXj0zEmE43ha1euENwkckKKel4XpSfokExPo5AiVStdHSAlHekz4d0CA/r45Ok1E4D3w==`.
- **Direct deps** (1.2.0):
  - `@clack/core@1.2.0` (license MIT, integrity verified concurrently)
  - `sisteransi@^1.0.5` (already common in the ecosystem; satisfied
    by lockfile resolution)
  - `fast-wrap-ansi@^0.1.3`
  - `fast-string-width@^1.1.0`

The `^` ranges on transitive deps are upstream's choice; pnpm's
lockfile pins the resolved versions so this is acceptable. Each
transitive resolution is captured in the lockfile when P0 installs.

- **Publish cadence**: 1.0.0 → 1.3.0 over Jan-Apr 2026, regular
  monthly cadence. No abandonment smell. No unexpectedly-large
  publishes.

### `open`

- **Latest published**: `11.0.0` on 2025-11-15 (~5.5 months old;
  passes buffer trivially).
- **Pinned for this arc**: `11.0.0`.
- **License**: MIT.
- **Author**: sindresorhus (well-known maintainer; has published
  `open` for a decade).
- **Engines**: `node >= 20`. Satisfied by Ductum's Node 22+.
- **Integrity**: `sha512-smsWv2LzFjP03xmvFoJ331ss6h+jixfA4UUV/Bsiyuu4YJPfN+FIQGOIiv4w9/+MoHkfkJ22UIaQWRVFRfH6Vw==`.
- **Direct deps** (all sindresorhus / well-known): `default-browser`,
  `define-lazy-prop`, `is-in-ssh`, `is-inside-container`,
  `powershell-utils`, `wsl-utils`.
- **Publish cadence**: 10.x line stable through 2024-2025; 11.0.0 is
  a major bump that consolidated platform helpers. No security
  advisories on 11.0.0 at audit time.

## Decision

Both audits pass. Pin exactly:

- `@clack/prompts` at `1.2.0`.
- `@clack/core` at `1.2.0` (transitive; pnpm resolves and locks).
- `open` at `11.0.0`.

The integrity hashes above are the source-of-truth for the install.
The `pnpm-lock.yaml` after P0 installs must contain these exact
values. CI's `pnpm install --frozen-lockfile` enforces.

## How to apply

- P0 (when it dispatches) runs `pnpm --filter @ductum/cli add
  @clack/prompts@1.2.0` (exact, no caret/tilde — `.npmrc` already
  enforces `save-exact=true`).
- P3 runs `pnpm --filter @ductum/cli add open@11.0.0` similarly.
- After install, the operator (or codex) runs `pnpm install
  --frozen-lockfile` to verify reproducibility.
- Any PR that bumps either pin must reference this decision and
  record a new audit. No silent upgrades.

## Non-goals

- Not auditing `@clack/core` separately — it's a sibling package
  from the same publisher under the same license, audited
  concurrently.
- Not auditing `sisteransi`, `fast-wrap-ansi`, `fast-string-width`
  individually beyond confirming they resolve to lockfile entries.
  They are well-established transitive deps and get tracked via the
  lockfile, not via a per-package decision.
- Not committing to forever-pinning `1.2.0`. When 1.3.0 (or later)
  passes the 7-day buffer at the time of a future bump, re-audit
  and ship the bump as its own decision.

## Slop review

- Attack any commit that pins `@clack/prompts` at a value other than
  `1.2.0` without amending this decision.
- Attack any commit that introduces caret/tilde ranges. Exact pins
  per D52.
- Attack any commit that adds a third TUI/browser dep without a
  paired audit decision.
- Attack a future bump that lands without a fresh audit recorded
  as its own decision.
