# D142 — Agent-First Task Set Status

Date: 2026-05-03

Status: Implemented

## Context

D115 Gap 2 left operators without a narrow way to close an abandoned task as
failed. D135 requires new agent-facing CLI surfaces to emit schema envelopes and
avoid free-form parsing.

## Decision

`ductum task set-status <id> <status>` is the new agent-first surface. It accepts
the settable task states `ready`, `active`, `blocked`, `done`, and `failed`.
`pending` remains an import/bootstrap state and is intentionally not exposed by
this operator command.

The CLI reads the task before writing, skips the API write when the task already
has the requested status, and returns a `task.set_status` envelope:

```json
{
  "schemaVersion": 1,
  "kind": "task.set_status",
  "data": {
    "taskBefore": {},
    "taskAfter": {}
  },
  "ts": "..."
}
```

The command reuses the existing task-status API route rather than adding a new
API endpoint. This keeps the bundle scoped to the requested CLI surface while
still making the new command script-safe.

## Consequences

The command is idempotent from the operator surface: repeated calls with the
current status do not mutate `updated_at`. Existing task-status API behavior is
left unchanged for older callers.
