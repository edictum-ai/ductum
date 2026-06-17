---
date: 2026-05-01
status: implemented (2026-05-01)
deciders: operator (Arnold Cartagena)
supersedes: none
related: 060, 109, 119, 121
---

# Decision 122: One-click approve auto-rebase

## Context

The merge-approval gate requires the run's branch to contain current
`main`. Every concurrent merge invalidates the next pending approval
and forces the operator through:

1. `ductum deny <runId> --reason "stale approval: branch …"`
2. `ductum retry <runId>` (or manual `git rebase` in the worktree)
3. wait for the dispatcher to redispatch and re-verify
4. wait for the reviewer to re-approve
5. `ductum approve <runId>` again

P3 hit this every time another spec landed mid-flight. The operator
saw the recovery commands suggested in the failure payload but had
to copy them by hand and accept the lost reviewer cycle.

## Decision

**`ductum approve <runId> --rebase` is the one-click recovery for
stale-branch approvals.** The CLI sends `POST
/api/runs/:id/approve-rebase`. Server-side, the API:

1. Validates the run is approval-eligible and has a worktree on
   disk.
2. Captures the pre-rebase commit SHA + branch.
3. Calls `rebaseWorktreeOntoBase(worktreePath, base)` (the same
   helper the post-completion router uses for parallel-merge
   conflicts).
4. **On rebase conflict**, dispatches a fix-rebase task to the
   original implementer (mirroring the existing
   `dispatchRebaseFix` flow) and returns
   `{ success: false, fixRebaseTaskId, reason }`. The dashboard /
   CLI shows the task id and tells the operator to wait for it to
   land before re-running `approve --rebase`.
5. **On clean rebase**, re-runs the workflow profile's verify
   commands in the rebased worktree. If verify fails, returns
   `{ success: false, verifyPassed: false, verifyOutput }` so the
   operator sees the regression and decides whether to deny + fix
   or extend.
6. **On verify pass**, re-links the new commit
   (`syncRunGitArtifacts`) and calls `approveRun` to drive the
   normal merge path. The approval succeeds end-to-end with no
   operator round-trip.
7. Records an `approval-rebase` evidence row capturing pre/post
   commits, the rebase outcome, and the verify result so the audit
   trail explains what happened during the reapproval.

The CLI presents the same affordance whether the rebase landed or
the fix-rebase task was dispatched, so the operator command surface
stays one line: `ductum approve <runId> --rebase`.

## Slop-review attack: hidden side effects

The slop review demanded the rebase path not silently swallow a
verify regression or a conflict. The implementation:

- Captures pre/post commits in evidence so a reviewer can compare
  the diff that landed vs. the diff that was originally approved.
- Refuses to merge when verify fails after rebase — returns
  structured failure instead.
- Refuses to merge when the rebase produces conflicts — dispatches
  a fix-rebase task with the conflict output so the original agent
  resolves it (the agent has the context, not the operator).
- Reuses the existing `mergeApprovedRun` for the actual merge so
  there is exactly one merge code path; the rebase flow is a
  pre-merge stage, not a parallel merge implementation.

## Surfaces shipped

- `packages/api/src/lib/run-ops/approval-rebase.ts` (NEW) —
  `approveRunWithRebase` orchestrates the entire flow and returns
  `ApproveRebaseResult` with the structured outcome fields.
- `packages/api/src/lib/run-ops.ts` — re-exports
  `approveRunWithRebase` and the result types.
- `packages/api/src/routes/runs.ts` — `POST
  /api/runs/:id/approve-rebase` route (body: `{ base?: string }`).
- `packages/api/src/lib/deps.ts` — adds `resolveVerifyCommands`
  callback to `ApiDeps` / `ApiContext` so the route can re-run
  verify in the rebased worktree using the same command resolution
  the dispatcher uses at spawn time.
- `packages/api/src/index.ts` — wires `resolveVerifyCommands` from
  the loaded workflow profiles map; the dispatcher's existing
  `resolveVerifyCommands` callback was unchanged.
- `packages/cli/src/api-client.ts`, `packages/cli/src/types.ts`,
  `packages/cli/src/tests/helpers.ts` — `approveRunWithRebase`
  client + test mock.
- `packages/cli/src/commands/factory-ops.ts` — `approve <runId>
  --rebase [--base <branch>]` option, plus a one-line `auto:`
  suggestion in the existing failure payload so operators discover
  the rebase path without reading docs.

## Future work

- Dashboard approval card: render the same `--rebase` action as a
  button. The route is in place; the React component still needs
  the wiring. Captured in `OPEN-QUESTIONS.md` for the next
  dashboard pass.
- Multi-conflict heuristic: when the fix-rebase task itself
  conflicts repeatedly, escalate to a human-edit prompt rather than
  another fix-rebase round. Not required for P3.

## Consequences

- Stale-branch approvals are recoverable with one CLI invocation.
- The audit trail captures pre/post commits + verify result so any
  reviewer or human approver can verify the rebased work matches
  the originally reviewed work.
- Rebase conflicts go back to the implementing agent — they have
  the context to resolve. The operator never edits a conflict
  marker.
- Verify regressions block the merge instead of silently shipping a
  rebased commit that breaks the build.
