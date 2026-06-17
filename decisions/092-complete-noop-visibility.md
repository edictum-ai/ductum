# 092 - Complete No-Op Visibility

## Status

Accepted

## Context

Dogfooding showed that `ductum complete <runId>` can return success while the
run stays in `stage=understand`, the task stays active, and no live harness
session exists to finish the post-completion path. Operators then have to use
`run-close` plus raw task status edits to stop duplicate retries. A completion
signal that silently changes nothing is worse than a loud blocker.

## Decision

Make completion no-ops visible:

- `ductum.complete` remains a signal for a live harness session to end cleanly.
- Completing a non-`done` run requires a live dispatcher session.
- Completing a terminal failed or stalled run fails loudly.
- Completing an approval-pending run still fails loudly.
- Completing a `done` run keeps the existing DAG/task finalization behavior.
- Invalid completion attempts must return API/CLI-visible errors, not an
  unchanged run payload.

## Why This Comes Next

The public URL slice was committed, but dogfood records exposed stale active
runs and duplicate retries caused by silent completion no-ops. This blocks
trusted unattended factory operation more directly than another resource shell.

## Non-Goals

- No new top-level primitive, table, Operation, or WorkOrder.
- No second policy system and no Edictum policy change.
- No dispatcher session mapping ownership change.
- No new dependency.
- No broad task lifecycle rewrite.
- No operator force-complete path in this slice.
