# P4 - Operator Queue Actionable Latest Run

## Problem

`ductum queue` can list multiple failed or stalled runs for the same active
task even though `ductum retry <runId>` and `ductum run-close <runId>` only
accept the latest run for that task. That leaves operators with concrete
commands that fail immediately.

## Behavior Contract

- Operator queues must only show failed or stalled runs that are actionable by
  the printed command.
- When several attempts exist for one active task, show only the latest
  failed/stalled attempt if no live sibling is working it.
- `ductum operator brief` and `ductum queue` must agree on the count.
- Approval and active-run leaf filtering must keep its existing behavior.
- No direct DB edits, no new tables, no new policy engine, and no dependency
  additions.

## Decision Trace

- Decision `053`: Ductum records work as tasks, runs, and evidence.
- Decision `060`: operator-visible workflow drift must be recorded explicitly.
- Decision `108`: integrity and operator readiness surfaces must be truthful.

## Verification

```sh
pnpm --filter @ductum/cli test -- queue-lineage queue-command
pnpm --filter @ductum/api test -- operator-brief
pnpm build
pnpm test
git diff --check
```
