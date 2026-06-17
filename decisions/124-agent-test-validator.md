---
date: 2026-05-01
status: implemented
deciders: opus (bakeoff candidate)
supersedes: none
related: 109, 114, 115, 118
---

# Decision 124: `ductum agent test` validator scope and `--all` parallelism

## Context

`ductum doctor` checks operator-direct readiness (env vars, dispatcher
state, repo configuration) but does not exercise an agent process
end-to-end. The first dispatch to a misconfigured agent (e.g.
`glm-5.1` without z.ai routing on 2026-05-01) wastes operator time
and dispatcher slots — the failure surfaces only after the dispatcher
matches and spawns. We needed a quick, single-shot smoke test that
proves the registered agent can actually spawn through its harness,
write a file in a worktree, and complete a session cleanly.

## Decision

Add `ductum agent test <name> [--verbose] [--no-cleanup] [--all]`.

Behavior:

- Idempotently maintain a hidden `agent-smoketest` spec on the
  `ductum` project (status `implementing`).
- Each invocation creates a fresh transient task with a deterministic
  prompt: write `agent-test-<name>.txt` containing
  `hello from <name>`, run a verify shell command, then call
  `ductum_complete`.
- Dispatch through the existing `/api/runs/dispatch` path. Single
  shot, no fix-loop, no retry.
- Poll the existing run API until terminal (default 5 minute window).
- Verify the artifact in the worktree (`run.worktreePaths[0]`).
- Map every observed failure to one of the named `firstError`
  categories so the operator gets actionable signal:
  `spawn-error`, `no-commit`, `verify-failed`, `max-turns`,
  `cost-cap-paused`, `timeout`, `unknown`. Spawn-error is detected
  both from a thrown dispatch and from the failure fingerprint
  (terminal failed + no session + no worktree).
- Cleanup default-on: remove the worktree, mark the smoke-test task
  done with operator-note "smoke test pass/fail". `--no-cleanup`
  keeps both for inspection.

## `--all` parallelizes

`--all` enumerates agents currently assigned to the `ductum` project
(any role) and runs them in parallel via `Promise.all`. Rationale:

- The dispatcher already enforces concurrency caps. Serializing in
  the validator on top of that buys nothing and slows operators.
- Parallel runs sit in the dispatcher queue naturally when the cap is
  saturated; the test still completes in bounded wall-clock time.
- A failing agent does not block the rest. Aggregate exit code is 1
  if any agent FAILed.

## Alternatives considered

- **Serialize `--all`.** Rejected: doubles the wall-clock for no gain
  the dispatcher cap already provides.
- **Embed run-lifecycle logic inline** instead of polling the
  existing API surface. Rejected: violates the validator's
  "no new harness wiring" rule from the spec.
- **Probe-only "say hi" SDK call.** Rejected: explicitly out of scope
  per spec — would not catch worktree, MCP, or commit issues.

## What this is NOT

- Not a benchmark. PASS/FAIL only; no quality comparison.
- Not an accept gate for production work — proves spawn + 1-step
  task completion, nothing more.
- Not a separate spawn path — reuses the registered harness adapter.

## Consequences

- Operators have a 30-second answer to "is this agent wired up?"
  before sinking real spec work into it.
- A new hidden `agent-smoketest` spec appears on the `ductum`
  project. Tasks under it churn (one per invocation) and are
  closed by cleanup.
- `firstError` taxonomy is now load-bearing for the validator;
  expanding `pauseDetail` shapes in the dispatcher should keep the
  six known prefixes (`max_turns_paused`, `cost_budget_paused`,
  `spec_cost_budget_paused`) intact or update this validator.
