# D145 — Operator Cancel Control

Date: 2026-05-03

Status: Implemented

## Context

D135 section 5 requires a first-class cancel path for live runs. Cancel is not
`run-close`: it is for non-terminal work the operator wants stopped now, with a
machine-readable API and CLI response, a typed evidence row, and an SSE event.

## Decision

`POST /api/runs/:id/cancel` accepts `{ "reason": "...", "cleanupWorktree":
true|false }` and returns the standard D135 `run.cancelled` envelope. The
durable cancel state is written in one DB transaction:

- `terminalState=cancelled`
- `failReason=null`
- `recoverable=false`
- approval/blocking latches cleared
- `operator.cancel` evidence recorded
- task DAG completion evaluated

The dispatcher kill path now accepts reason `cancelled`; harness adapters map
that to their existing forced-kill mechanics while preserving the API-level
terminal state. The dispatcher frees `activeSessions` immediately through the
existing `killRun` path.

Worktrees are preserved by default. `cleanupWorktree=true` removes the run's
worktree paths through the server's `WorktreeManager` when available, then
clears `run.worktreePaths`.

The CLI surface is `ductum cancel <runId> --reason <text>
[--cleanup-worktree]`. It honors the D135 output resolver and emits
`run.cancelled` envelopes in JSON/NDJSON modes.

The dashboard run detail view now shows an operator cancel control for live
runs. It posts the same API shape and refreshes run/resolve/operator-brief
queries after success. The evidence renderer now has a typed
`operator.cancel` renderer.

## Consequences

`cancelled` is now a real terminal state in the core type and SQLite schema.
It is intentionally distinct from `failed` and `stalled`, so downstream agents
can tell "operator intentionally stopped this" apart from runtime failure.

Adapter-level cancellation remains a forced kill result internally. That keeps
existing harness completion loops simple and avoids adding a new harness
`exitReason` that core does not route through post-completion.
