# Worker brief - phase2 lease and fencing

Repo worktree: `/Users/acartagena/project/dn-p2-lease-fencing`
Branch: `stream/p2-lease-fencing`
Suggested model: GPT 5.5
Migration reserved: `044_attempt_leases`

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/ROADMAP.md` Phase 2
- `design/01-shape.md`, lease/fencing sections
- `design/04-autonomy-recovery.md`, section 2 and the fencing decision
- `design/parallel/phase2-gate-transaction.md`
- `packages/core/src/dispatcher-cycle.ts`
- `packages/core/src/dispatcher-spawn.ts`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/state-machine.ts`
- `packages/core/src/enforce.ts`
- `packages/core/src/repos/run.ts`
- `packages/core/src/repos/run-checkpoint.ts`
- `packages/core/src/repos/evidence.ts`
- `packages/core/src/dispatcher-session-cost.ts`

## Problem

Checkpoint/resume and transactional gate commits now exist, but live ownership is
still mostly process memory plus session control tokens. If a presumed-dead worker
wakes up after a resumed owner has taken over, recovery-critical writes can still
land from the stale owner. Phase 2 needs a durable lease ledger with monotonic
fencing before the reconciler/autonomy streams build on top of recovery.

## Task

Add the smallest useful lease/fencing layer behind the current dispatcher path.

Expected shape:

- Add a durable `AttemptLease` model/repo and guarded migration
  `044_attempt_leases`.
- Store a monotonic fence token from durable SQLite state, not process memory.
- Mint a lease when the dispatcher takes ownership of a run for an agent session.
- Renew the active lease on the existing live-session heartbeat path.
- Release/expire leases cleanly when the session ends or is abandoned.
- Fence-guard only recovery-critical writes named in design/04:
  terminal-state transitions, checkpoint upserts, evidence commits, and cost
  records.
- On stale-fence rejection, fail closed with a visible error/evidence/log path;
  do not silently accept or retry forever.
- Keep `refreshRunFromWorkflow`'s `done` guard unchanged.
- Do not start the reconciler rewrite, quarantine, drain, or `whatToDoNext` in
  this stream.
- If the current run/attempt model makes cross-run same-worktree fencing unsafe
  to solve narrowly, record that as a decision/follow-up instead of broadening
  into a dispatcher identity rewrite.

## Tests

Add focused tests for:

- migration creates the lease table/sequence and is idempotent
- dispatch mints a lease and heartbeat renewal extends it
- session completion releases or closes the lease
- stale owner cannot write terminal state after a higher fence exists
- stale owner cannot commit checkpoint/evidence/cost after a higher fence exists
- current owner can still commit the transactional gate path from the prior stream
- recovery/resume path obtains a fresh higher fence before writing

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

Commit locally on `stream/p2-lease-fencing`. Conventional commit subject. No AI
attribution. Do not push.
