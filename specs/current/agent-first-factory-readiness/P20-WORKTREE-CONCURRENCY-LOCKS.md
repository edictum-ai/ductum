# P20 - Worktree Concurrency Locks

## Problem

Ductum can start competing fix/review runs on the same worktree lineage. That
caused avoidable contention during the Codex elicitation repair path. The
factory needs a conservative guard so only one live run owns a shared worktree
lineage at a time.

## Scope

- Write scope: dispatcher/router/worktree scheduling and tests.
- Do not touch dashboard or onboarding docs in this slice.
- Do not add a new table.

## Behavior Contract

- A run must not dispatch if another live run already owns the same worktree
  path or lineage root.
- Reviews and fixes for the same implementation branch must queue rather than
  run concurrently.
- Independent tasks with distinct worktrees must still dispatch in parallel.
- Merge cleanup must continue to kill stale descendants sharing a worktree.

## Verification

```sh
pnpm --filter @ductum/core test -- dispatcher
pnpm --filter @ductum/api test -- routes
pnpm build
git diff --check
```

## Decision Trace

- Decision `026`: watchers/descendants must respect lineage.
- Decision `053`: runs are the factory truth.
- Decision `108`: operator-visible active work must be truthful.

## Slop Review

- Attack guards that serialize all work instead of only shared worktrees.
- Attack advisory-only prompts; this must be structural scheduling behavior.
- Attack new storage or new primitives.
