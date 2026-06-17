# P17 - Dashboard Approval Recovery UX

## Problem

The dashboard approval action can feel like "nothing happened" when the API
rejects the approval because the branch is stale or otherwise not mergeable.
The operator needs a visible failure, the next exact command, and the affected
run/branch without opening logs.

## Scope

- Write scope: `packages/dashboard/**` and dashboard tests only.
- Do not change API approval semantics in this slice.
- Do not add dependencies.

## Behavior Contract

- A failed approval must leave an operator-visible error on the approval card.
- The UI must show the API-provided recovery guidance when present.
- Stale-branch failures must show "deny/retry/rebase" style next steps without
  requiring log inspection.
- A failed approval must not optimistically remove the card from the queue.
- Existing successful approve/reject behavior must keep working.

## Verification

```sh
pnpm --filter @ductum/dashboard test
pnpm --filter @ductum/dashboard build
git diff --check
```

## Decision Trace

- Decision `053`: runs/evidence are the factory truth.
- Decision `060`: dogfood drift must become explicit work.
- Decision `108`: operator-visible state must not lie about live work.

## Slop Review

- Attack fake success states after failed approval.
- Attack UI text that hides the next command.
- Attack any API behavior changes in this dashboard-only slice.
