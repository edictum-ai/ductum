# P5 - Operator Queue Latest Overall Run

## Problem

After retrying `nAZkr3nfyW7y`, Ductum created a newer approval-ready run for
the same task. `ductum operator brief` correctly reported `needsOperator: 0`,
but `ductum queue` still listed the older failed run as retryable. The printed
command was stale because run retry/close only accepts the latest task run.

## Behavior Contract

- `ductum queue` must derive needs-operator rows from the latest overall run
  for each active task, not the latest stopped run.
- A failed/stalled older attempt must disappear when a newer run is active,
  approval-ready, done, or otherwise latest.
- `ductum queue` and `ductum operator brief` must agree on counts.
- Approval rows must keep showing their own actionable approval command.
- No direct DB edits, no new tables, no new policy engine, and no dependency
  additions.

## Decision Trace

- Decision `053`: tasks/runs/evidence are the factory state.
- Decision `060`: stale operator guidance is decision drift and must be fixed.
- Decision `108`: operator readiness surfaces must be truthful and actionable.

## Verification

```sh
pnpm --filter @ductum/cli test -- queue-lineage queue-command
pnpm --filter @ductum/api test -- operator-brief
pnpm build
pnpm test
git diff --check
```
