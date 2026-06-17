# D167: Release Dependency Policy

Date: 2026-06-09

## Status

Accepted.

## Context

Ductum is preparing for trusted npm publishing. Release safety now depends on
dependency audit posture, exact pins, disabled lifecycle scripts, and a narrow
set of native packages allowed to build from source.

## Decision

Release gates must block critical and high npm advisories. A critical or high
advisory may ship only when a separate decision explicitly accepts the advisory,
the affected package path, the blast radius, and the planned removal or update.

All direct dependencies and overrides stay exact-pinned. New dependency updates
use the 7-day freshness rule: do not select a version published less than seven
days ago unless no patched version outside that window exists and a decision
records the exception.

The accepted native/binary runtime package families are:

- `@anthropic-ai/claude-agent-sdk-*`
- `@github/copilot-*`
- `@openai/codex` and `@openai/codex-*`

These are accepted only as transitive packages from the direct provider SDKs
already in the published `ductum` manifest.

The accepted native/binary build-script allowlist is:

- `better-sqlite3`
- `esbuild`

`pnpm.onlyBuiltDependencies` must remain exactly that list. Installs must keep
`--ignore-scripts`; release and CI may rebuild only the accepted native packages.

Unknown-license packages are not accepted by default. The release gate fails if
an installed package root has no known license unless a decision explicitly
allowlists the package name and version.

Dashboard-only dependencies must not be present in the published
`packages/ductum` manifest. Dashboard libraries may remain in
`packages/dashboard` only.

## Cadence

Run dependency audit and minimization before every npm release. Do a deeper
direct dependency review monthly or before any new agent/provider/runtime
package is added.

## Consequences

`pnpm audit --audit-level=high` is a CI and release gate. Low and moderate
advisories are still tracked, but they do not unblock a release when critical
or high advisories remain.
