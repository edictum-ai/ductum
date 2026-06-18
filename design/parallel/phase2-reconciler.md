# Worker brief - phase2 reconciler

Repo worktree: `/Users/acartagena/project/dn-p2-reconciler`
Branch: `stream/p2-reconciler`
Suggested model: GPT 5.5
Migration reserved: none expected

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/ROADMAP.md` Phase 2
- `design/04-autonomy-recovery.md`, section 4
- `design/parallel/phase2-lease-fencing.md`
- `packages/core/src/dispatcher-reconcile.ts`
- `packages/core/src/dispatcher.ts`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/dispatcher-recovery.ts`
- `packages/core/src/dispatcher-lease.ts`
- `packages/core/src/repos/attempt-lease.ts`
- `packages/core/src/run-checkpoint.ts`
- `packages/core/src/repos/run-checkpoint.ts`
- `packages/api/src/lib/reconcile.ts`
- `packages/api/src/lib/reconcile-pass.ts`
- `packages/api/src/lib/reconcile-audit.ts`
- `packages/api/src/lib/reconcile-orphans.ts`

## Problem

Phase 2 now has durable checkpoints, transactional gate commits, explicit
provider/account failover identity, and a durable attempt lease with fencing.
Startup recovery is still split between two surfaces:

- core `reconcileOrphanedSessions`, which still talks about `tryReattach`
  even though shipped adapters do not implement a real durable reattach path
- API `reconcileInconsistentRuns`, which repairs stale/merged/orphan shapes but
  is not the single classification-first recovery entry point

The next slice is a narrow reconciler pass that classifies durable run state
truthfully and uses the lease/checkpoint model to decide what to resume,
finalize, release, or escalate.

## Task

Refactor the current reconciliation paths toward the design/04 section 4 target
without starting the autonomy supervisor or `whatToDoNext`.

Expected shape:

- Make startup/core reconcile classification-first. Each active non-terminal run
  should land in exactly one named disposition derived from durable state.
- Cover at least these dispositions with explicit names and visible audit data:
  `already-live`, `resumable`, `completed-but-unrecorded`, `dead-claim`,
  `genuinely-stalled`, and `no-mapping`.
- Use `AttemptLease` truth. Expired active leases are dead claims; stale owners
  must not be treated as live just because `session_run_mapping` exists.
- Use `RunCheckpoint` truth. Runs with a valid checkpoint and reusable worktree
  should route to the existing resume path under a fresh lease, not to dead
  `tryReattach` scaffolding.
- Be honest about reattach. Prefer deleting or bypassing the dead `tryReattach`
  branch and changing logs/tests to say checkpoint resume. If you keep
  `tryReattach`, it must be backed by a real adapter path and tests.
- Keep every reconcile action auditable with `state-reconcile` evidence or a
  dry-run result. No silent no-op branches.
- Do not add quarantine, drain, `AutonomySupervisor`, or `whatToDoNext` in this
  stream.
- Do not change `refreshRunFromWorkflow`'s `done` guard.
- Keep API reconcile compatibility unless intentionally retiring a path with
  tests that prove the replacement covers it.

## Tests

Add focused tests for:

- expired lease + checkpoint classifies as `resumable` and calls the existing
  resume/dispatch path with a fresh higher fence
- expired lease + no checkpoint classifies as `dead-claim` or
  `genuinely-stalled` with visible audit data
- active valid lease is not stalled or resumed
- missing session mapping is visible as `no-mapping`
- completed-but-unrecorded merged/pushed run is finalized idempotently
- dry-run reconcile returns the same dispositions without writing DB state
- dead `tryReattach` claims/logging are removed or made truthful

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

Commit locally on `stream/p2-reconciler`. Conventional commit subject. No AI
attribution. Do not push.
