# P1 - Lifecycle Status Repair

## Decision Trace

- D166 accepts the Spec -> Task -> Attempt operator model.
- D173 makes `whatToDoNext` the shared operator-legibility source.
- Current live proof: run `HJLQO4vgMBzD` accepted `ductum_complete`, dispatched a
  review, but still appears active/running; its failed review is not surfaced in
  Needs Attention.

## Behavior Contract

- [ ] FAILS if `ductum_complete` can return ok and leave the run indefinitely
  active without a routed post-completion state; evidence: core dispatcher/API
  regression tests.
- [ ] Failed review runs must be visible as operator-needed or cause an
  actionable bakeoff/spec failure; evidence: CLI/API status and compare tests.
- [ ] Bakeoff/spec status must not remain implementing after all meaningful child
  work is terminal; evidence: bakeoff compare and spec list regression tests.
- [ ] Recovery must use public Ductum state transitions, not manual SQLite
  edits; evidence: test plus live `ductum status`.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
pnpm -C packages/cli build
pnpm -C packages/cli exec vitest run
node scripts/check-file-size.mjs
git diff --check
```

## Drift Handling

If the fix requires changing workflow semantics, approval semantics, or task
terminal-state semantics, stop and record a decision first.

## Slop Review

- [ ] Attack runtime behavior: can accepted completion still depend on a
  live adapter callback that may never arrive?
- [ ] Attack runtime behavior: can failed child review, malformed judge, frozen,
  failed, stalled, or quarantined runs be hidden by a live parent or stale task
  status?
- [ ] Attack explicit evidence: can compare/spec list disagree about running,
  failed, complete, or approved?

## Objective

Fix the lifecycle truth bugs that prevent unattended operation.

## Read first

- `AGENTS.md`
- `design/README.md`
- `decisions/166-operational-model-redesign-closeout.md`
- `decisions/173-quarantine-and-next-action.md`
- `packages/api/src/routes/runs.ts`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/post-completion-router-task-completion.ts`
- `packages/core/src/post-completion-router-route-blind-review.ts`
- `packages/core/src/what-to-do-next.ts`
- `packages/api/src/lib/bakeoff-compare.ts`
- `packages/cli/src/commands/status-data.ts`
- Current live attempt shape: `ductum status HJLQO4vgMBzD` on the Qratum
  factory shows `stage=implement`, `terminalState=null`, after accepted
  `ductum_complete`.

## Allowed Scope

- Core dispatcher completion routing, review failure routing, task/spec status
  derivation, API/CLI status and compare output.
- Tests in core/API/CLI around the exact lifecycle states.
- A public repair/reconcile path for the already-stuck live run if needed.

## Non-goals

- Do not manually edit SQLite.
- Do not change `refreshRunFromWorkflow`'s `done` guard.
- Do not broaden fencing beyond what the bug requires.
- Do not change provider routing, model setup, Podman execution, or auto-approval
  policy in this task.

## Implementation Notes

- `completeRun` currently records completion and asks the dispatcher to end the
  session; it can return a still-active run. Make that intermediate state
  durable and finite, or route completion synchronously enough that status is
  never a ghost.
- Failed review tasks should not be masked by a still-active parent candidate.
  If review failure blocks progress, the operator must see it.
- Bakeoff status should derive from terminal child work and review state, not a
  stale parent stage alone.

## Acceptance Criteria

- The live stuck shape has a regression test.
- Failed review with malformed completion becomes visible in Needs Attention or
  actionable bakeoff compare output.
- A parent candidate that has accepted completion and dispatched review does not
  remain an active leaf forever.
- After applying the fix, the current Qratum factory does not show the same
  hidden active/failed-review inconsistency.

## Stop Conditions

- Any change that requires a new workflow state or public status name without a
  decision.
- Any temptation to patch the live DB by hand.
- Any failing core/API/CLI verification that is not understood and recorded.
