# P6 - Approval Stale Retry Guidance

## Problem

Approving run `eS6S0-3rOQsM` correctly failed because its branch no longer
contained current `main`. The failure message told the operator to retry the
run, but `ductum retry eS6S0-3rOQsM` refused because the run was still
non-terminal and approval-ready.

The working operator path was to deny the stale approval with an explicit
reason, then retry the now-failed run. The CLI/API should not print a blocked
next command.

## Behavior Contract

- A stale approval failure must show an immediately executable next command.
- The operator must not need to infer that `deny` is required before `retry`.
- `ductum queue` and approval failure output should distinguish retryable
  failed/stalled runs from approval-ready stale branches.
- The fix must preserve the current safety check: stale branches must not merge.
- No direct database edits, no new tables, no new policy engine, and no new
  dependencies.

## Decision Trace

- Decision `053`: run state and evidence must remain the factory source of
  truth.
- Decision `060`: stale command guidance is decision drift.
- Decision `108`: operator readiness requires truthful, actionable recovery
  surfaces.

## Verification

```sh
pnpm --filter @ductum/api test -- routes
pnpm --filter @ductum/cli test -- factory-ops-command commands queue-command
pnpm build
pnpm test
git diff --check
```
