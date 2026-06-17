---
date: 2026-05-02
status: accepted
deciders: operator (Arnold Cartagena), Codex
supersedes: none
related: 115, 131, 133
---

# Decision 134: Dispatcher rotates around recently failing agents

## Context

D115 Gap 8 was hit live during recovery: one agent repeatedly failed with a
recoverable harness/model issue while other eligible agents were available. The
dispatcher retried the same agent instead of selecting the next capable agent.

D133 also introduced `prompt_overflow` as a typed harness failure. That failure
is agent/runtime recoverable by rotation because another capable agent or a
split task may avoid the same prompt limit.

## Decision

Track in-memory agent health inside the dispatcher:

- recoverable agent-level failures are model-not-found, auth failures,
  network-refused errors, and `prompt_overflow`
- three recent failures inside a ten-minute window mark the agent unhealthy
- unhealthy agents are skipped by automatic dispatcher selection for five
  minutes
- manual reset clears the health state immediately

The health state is intentionally in-memory. It is a runtime circuit breaker,
not historical audit state. Durable evidence and failure rows remain on the
runs that failed.

Spawn-time failures and terminal harness failures both feed the same counter.
That covers the actual D115 failure mode where a model/harness rejection happens
before the session can do useful work, plus the D133 prompt-overflow terminal
path.

## Operator Surface

`ductum agent health` now includes recent failure count and unhealthy state.
`ductum agent reset-health <name>` clears the in-memory state through
`POST /api/agents/:name/health/reset`.

The API exposes `GET /api/agents/health` so dashboards and future operator
surfaces can read the same state without scraping logs.

## Consequences

Automatic dispatch no longer burns slots retrying a repeatedly broken agent
when another eligible agent is available. Operators can still manually dispatch
or reset a recovered agent, and the five-minute cool-off prevents a transient
outage from permanently excluding the agent.

## Verification

- `packages/core/src/tests/dispatcher-spawn.test.ts` proves three failures
  route the next task to a different builder, the five-minute cool-off restores
  eligibility, and manual reset clears the state.
- `packages/cli/src/tests/agent-health-rotation-command.test.ts` proves the CLI
  displays health and calls reset.
- `packages/api/src/tests/routes/agent-health.routes.test.ts` proves the new
  API routes are reachable before the generic agent `/:id` route.
