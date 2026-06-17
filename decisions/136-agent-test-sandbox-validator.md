---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena), Codex
supersedes: 124
related: 115, 135
---

# Decision 136: `ductum agent test` uses a sandbox factory by default

## Context

D124 shipped `ductum agent test` as a real end-to-end dispatch smoke test.
That was useful, but it wrote the hidden `agent-smoketest` spec, transient
tasks, and runs into the operator's active factory database. D135 makes the
operator surface agent-first, so validator probes must not contaminate the
factory state they are meant to protect.

## Decision

`ductum agent test` now opens an isolated validator factory by default:

- `DUCTUM_DB_PATH` is set to `/tmp/ductum-validator-<random>.db`.
- The sandbox API runs on an ephemeral loopback port with dashboard disabled.
- The existing smoke-test logic runs unchanged against that sandbox API.
- The active factory API is still used for `--dry-run`, because dry-run only
  validates the planned agent selection and never creates a task or dispatches
  a run.

Tests use a sandbox API seam instead of spawning a child server. Production uses
`node scripts/serve.mjs --db <path> --no-dashboard` so the same config seeding
path feeds the sandbox.

## Consequences

The validator can still exercise real harness dispatch, worktree creation, and
completion, but the operator's real database does not receive smoke-test runs.
The `--dry-run` path gives operators a zero-write check for scripts and CI
preflight.

## Verification

- `packages/cli/src/tests/agent-test-command.test.ts` proves the default
  command dispatches through the sandbox API and not the active factory API.
- The same test file proves `--dry-run` does not create specs, tasks, or runs.
