---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena), Codex
supersedes: none
related: 115, 135
---

# Decision 137: Dispatcher auto-closes stale slots

## Context

D115 Gap 9 identified active run rows that no longer had a live dispatcher
session. Those rows consumed operator attention and could leave tasks active
after a server crash or lost in-memory session.

## Decision

Every dispatcher cycle now runs stale-slot GC after refreshing known live
sessions and before normal heartbeat stall handling.

A run is auto-closed when:

- it is still active (`stage != done` and `terminalState = null`),
- it has no live `activeSessions` entry in this dispatcher process,
- it is not currently inside `handleSessionEnd` post-completion routing,
- its `lastHeartbeat` is older than `heartbeatTimeoutSeconds * 2`.

The `stage != done` guard is deliberate: Ductum represents successful completed
runs as `stage = done` with `terminalState = null`, so applying the literal
terminal-state-only predicate would corrupt shipped history.

Auto-closed runs are marked `terminalState = stalled` with
`failReason = stale_slot_gc`, their active task is failed through the existing
heartbeat-stall path, and a `slot.auto_closed` event is emitted for downstream
operator streams.

## Operator Surface

`GET /api/factory/operator-brief` now includes
`staleSlotsAutoClosed`, the total number of runs closed by this GC path.

## Verification

- `packages/core/src/tests/dispatcher-spawn.test.ts` proves stale active rows
  without a live session are closed, emit `slot.auto_closed`, and fail the task.
- `packages/api/src/tests/operator-brief.test.ts` proves the brief counter is
  surfaced.
