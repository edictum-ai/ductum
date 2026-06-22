# Worker brief - phase2 transactional gate/evidence commit

Repo worktree: `/Users/acartagena/project/dn-p2-gate-transaction`
Branch: `stream/p2-gate-transaction`
Suggested model: GPT 5.5
Migration reserved: `044_gate_commit_transactions` if needed

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/ROADMAP.md` Phase 2
- `design/04-autonomy-recovery.md`, sections 1 and 3
- `packages/core/src/enforce.ts`
- `packages/core/src/repos/evidence.ts`
- `packages/core/src/repos/run-checkpoint.ts`
- `packages/core/src/run-checkpoint.ts`
- `packages/core/src/state-machine.ts`
- `packages/core/src/evidence-content-hash.ts`

## Problem

Evidence is now content-addressed and checkpoints exist, but the gate path still needs
an explicit transactional boundary so evidence, gate evaluation, stage advance, and
checkpoint move together. A crash during gate commit must not leave a checkpoint that
claims evidence/stage state that was not durably committed.

## Task

Create a transactional gate commit path for replayable gate/evidence writes.

Expected shape:

- Keep `refreshRunFromWorkflow`'s `done` guard exactly where it is.
- Use the existing content-addressing behavior for replayable evidence.
- Add one clear transaction around gate evidence, gate evaluation, workflow stage
  advance, run stage update, and checkpoint upsert where those operations are part
  of the same gate commit.
- Keep append-only operator notes semantically append-only.
- If the current repository abstractions make a clean transaction impossible, add
  a small local transaction helper instead of rewriting repos broadly.
- Do not start lease/fencing in this stream. Leave fence-token plumbing to the next
  branch.

## Tests

Add focused tests for:

- duplicate replayable gate commit creates one evidence row
- injected failure mid-commit leaves stage/evidence/checkpoint consistent
- successful gate commit advances stage and checkpoint together
- operator/custom note evidence still behaves append-only where expected

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

Commit locally on `stream/p2-gate-transaction`. Conventional commit subject. No AI
attribution. Do not push.

