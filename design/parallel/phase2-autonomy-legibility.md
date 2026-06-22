# Worker brief - phase2 autonomy + legibility

Repo worktree: `/Users/acartagena/project/dn-p2-autonomy-legibility`
Branch: `stream/p2-autonomy-legibility`
Suggested model: GPT 5.5
Migration reserved: `045_quarantine_and_next_action`

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/ROADMAP.md` Phase 2
- `design/04-autonomy-recovery.md`, sections 5 and 6
- `design/parallel/PHASE2-PLAN.md`
- `design/parallel/phase2-reconciler.md`
- `packages/core/src/state-machine.ts`
- `packages/core/src/types.ts`
- `packages/core/src/dispatcher.ts`
- `packages/core/src/dispatcher-reconcile.ts`
- `packages/core/src/dispatcher-stalled-retry.ts`
- `packages/core/src/dispatcher-agent-health.ts`
- `packages/core/src/repos/interfaces.ts`
- `packages/core/src/db-migrations.ts`
- `packages/api/src/lib/reconcile.ts`
- `packages/cli/src/commands/status-data.ts`
- dashboard inbox/home surfaces that currently decide operator-needed state

## Problem

Phase 2 now has provider/account failover identity, checkpoint resume,
transactional gate commits, lease fencing, and a truthful startup reconciler.
The factory still does not have one durable answer for "what happens next":

- deterministic poison failures still collapse into generic `failed`
- operators infer queue skips and heartbeat stalls from logs
- CLI and dashboard each derive their own next action
- no thin autonomy wrapper owns recover/quarantine/escalate policy

The next slice is autonomy legibility, not a dispatcher rewrite.

## Task

Implement the narrow section 5/6 slice:

- Add a distinct `quarantined` terminal state with a guarded migration.
- Route retry-budget-exhausted deterministic failures to `quarantined` instead
  of generic `failed`. Keep ambiguous/provider/transient failures out of
  quarantine.
- Add a pure core `whatToDoNext` derivation over durable run/task state.
- Make CLI status and the dashboard/operator inbox consume that derivation
  instead of duplicating status logic.
- Persist or expose durable skip reasons for common silent skips where the data
  already exists, especially agent cooldown, worktree/slot contention, approval
  gates, budget/turn hard stops, resumable checkpoints, quarantined tasks, and
  genuinely-stalled reconcile outcomes.
- Keep the supervisor thin. If you add `AutonomySupervisor`, it must wrap the
  existing dispatch cycle and call existing dispatcher/reconciler methods; do
  not rewrite the dispatcher inheritance stack in this stream.
- Keep every operator-needed state visible from API/CLI/dashboard without log
  archaeology.

## Out of scope

- Do not implement remote workers, queues, PgQueue, package splits, or plugin
  loading.
- Do not reintroduce `tryReattach`.
- Do not change `refreshRunFromWorkflow`'s `done` guard.
- Do not broaden fencing beyond the recovery-critical writes already guarded.
- Do not do a visual redesign; only wire state data needed by existing UI.
- Do not implement a full graceful drain unless the small supervisor wrapper
  makes it straightforward with tests. If it starts spreading, record it as the
  next stream instead.
- Do not change cost accounting unless it is a small, tested `unmeasured`
  legibility thread. If it needs schema/API churn, flag it for the cost follow-up.

## Tests

Add focused tests for:

- deterministic retry-budget exhaustion enters `quarantined`, not `failed`
- transient/provider failures do not quarantine on first ambiguity
- quarantined tasks are not redispatched and are visible as operator-needed
- `whatToDoNext` is total over active, approval, blocked, retrying, resumable,
  stalled, failed, cancelled, paused/frozen, quarantined, and done run shapes
- CLI status shows the same next action text/data as the core derivation
- dashboard/API contract exposes enough data for the inbox to avoid duplicate
  state inference
- migration accepts legacy terminal states and widens only to the new state

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
pnpm -C packages/cli build
pnpm -C packages/cli exec vitest run
pnpm -C packages/dashboard build
pnpm -C packages/dashboard exec vitest run
node scripts/check-file-size.mjs
git diff --check
rg -n "tryReattach|ORPHANED_|reattach" packages
```

Commit locally on `stream/p2-autonomy-legibility`. Conventional commit subject.
No AI attribution. Do not push.
