# Worker brief - quarantine lineage-cleanup preserve

Repo worktree: `/Users/acartagena/project/dn-p2-quarantine-lineage`
Branch: `stream/p2-quarantine-lineage`
Suggested model: GPT 5.5
Migration reserved: none

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `decisions/173-quarantine-and-next-action.md`
- `packages/core/src/failed-lineage-cleanup.ts`
- `packages/core/src/state-machine.ts`
- `packages/core/src/lifecycle-types.ts`
- `git show 228906b`
- `packages/core/src/tests/workflow-profile-lineage.test.ts`
- any test that exercises `failed-lineage-cleanup` (`rg failed-lineage-cleanup packages/core/src/tests packages/core/src`)

## Problem

Decision 173 leaves a quarantined task `active` with its run in the distinct
`quarantined` terminal state. Commit `228906b` fixed the API reconciler, which
was marking that active task `failed` and destroying the quarantine. The same
defect class is still open in `failed-lineage-cleanup.ts`.

`cleanupLineage` force-closes stale sibling runs in a lineage. Its current guard
only excludes done and failed:

```ts
if (run.stage !== 'done' && run.terminalState !== 'failed') {
  ctx.stateMachine.markFailed(run.id, options.reason)
  closedRunIds.push(run.id)
}
```

A run already in `cancelled`, `paused`, `frozen`, or `quarantined` passes the
guard and is silently re-marked `failed`. `markFailed` does not guard an
already-terminal run. `closeCurrentRun` has the same hole on both its `markDone`
and `markFailed` branches, because it checks only `stage === 'done'` /
`terminalState === 'failed'`.

A quarantined poison run swept by a sibling's lineage cleanup can therefore be
un-quarantined back to `failed`, reopening the exact hole `228906b` closed.

## Task

Make lineage cleanup preserve any run that is already in a terminal state. A run
that is already terminal is already closed from the lineage's perspective;
cleanup must only force-close runs that are still active.

Recommended fix:

- Narrow cleanup force-close paths to runs with `run.terminalState == null &&
  run.stage !== 'done'`.
- Apply the same terminal-state awareness to `closeCurrentRun` on both the
  `markDone` and `markFailed` branches.
- Do not re-mark a terminal run as done either.

This changes one existing behavior worth a conscious note: a `stalled` sibling
run is currently force-closed to failed; with the recommended fix it is left
stalled. That is more truthful and safe: stalled runs are already terminal,
excluded from active run queries, and not redispatched. If any existing test
asserts stalled-to-failed clobbering, update it intentionally and mention that in
the commit body.

If you choose the minimal fix instead, you may keep force-closing stalled and
only additionally exclude deliberate halt states (`cancelled`, `paused`,
`frozen`, `quarantined`). Either way, a quarantined run must survive cleanup in
its quarantined state.

## Out of scope

- Do not change quarantine routing, the classifier, `whatToDoNext`, or display /
  UI-contract code.
- Do not change the reconcile-pass fix from `228906b`.
- Do not broaden fencing.
- Do not touch `refreshRunFromWorkflow`'s `done` guard.
- Do not add a migration.
- Do not reintroduce `tryReattach` / `ORPHANED_` symbols.

## Tests

Add focused tests for `failed-lineage-cleanup`:

- a quarantined run swept by a sibling's lineage cleanup is not re-marked; it
  stays quarantined and is absent from `closedRunIds`
- paused, frozen, and cancelled sibling runs are likewise preserved
- an active sibling run (`terminalState == null`, `stage !== 'done'`) is still
  force-closed to failed
- a done run is still skipped
- if you narrow the stalled case, add a test asserting the preserved stalled
  behavior and note any updated prior test

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
node scripts/check-file-size.mjs
git diff --check
rg -n "tryReattach|ORPHANED_|reattach" packages
```

Commit locally on `stream/p2-quarantine-lineage`. Conventional commit subject.
No AI attribution. Do not push.
