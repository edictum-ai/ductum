# Fix P3 - Attach Review Evidence To Approval Root

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P3-AUTO-APPROVAL-POLICY`

Authorized internal work. Do not push.

## Required Branch Setup

This repair must build on the latest P3 repair branch, not plain `main`.

Before editing source files, verify:

```sh
git merge-base --is-ancestor 5165233d HEAD
```

The command must exit 0. If it exits non-zero, stop and report that branch setup
is missing. Do not create `.git-local`, do not reset the branch, and do not try
to bypass worktree git metadata. The orchestrator is responsible for pre-merging
`ductum/fix-P3-AUTO-APPROVAL-POLICY-r8-KSjS0s` before implementation starts.

## Read First

- `design/parallel/unattended-factory-hardening/P3-AUTO-APPROVAL-POLICY.md`
- `design/parallel/unattended-factory-hardening/fixes/P3-AUTO-APPROVAL-POLICY-r6.md`
- `packages/core/src/post-completion-router-route-review.ts`
- `packages/core/src/post-completion-router-base.ts`
- `packages/api/src/index.ts`
- `packages/api/src/lib/run-ops/approval.ts`
- `packages/core/src/unattended-approval-policy.ts`
- `packages/api/src/tests/routes/approval-unattended.routes.test.ts`
- `packages/core/src/tests/unattended-approval-policy.test.ts`

## Review Finding

The r8 review failed with this blocking finding:

> `packages/core/src/post-completion-router-route-review.ts:41` and
> `packages/api/src/index.ts:379-385` record `onReviewResult` evidence against
> `reviewRun.id`, but `packages/api/src/lib/run-ops/approval.ts:74-76`
> evaluates only `context.repos.evidence.list(rootRunId)` for the run being
> approved. Review runs do not carry the root commit/worktree, and the evidence
> is not attached to the root run that `onReadyToShip` advances, so the normal
> runtime reviewer PASS path still leaves the root without current
> `internal-review` evidence and unattended approval can still block with
> `valid review/judge result has not passed`. The added API test manually
> creates review evidence on the root run and therefore does not cover this
> production callback path.

## Task

Make the production review-pass callback path satisfy unattended approval for
the root implementation run.

Required behavior:

- When a review run passes and advances a root/fix implementation run to ship,
  the approval root must receive current `internal-review` evidence for the
  reviewed commit.
- Evidence on the review run may remain for audit, but it must not be the only
  evidence used by unattended approval.
- Keep stale-evidence protection: review evidence for another commit must not
  satisfy approval.
- Do not weaken dirty/conflicted/security/scope/budget checks.

## Tests

Add or update focused tests that fail before the fix and pass after:

- a production post-completion review PASS path records/copies review evidence
  onto the root run that is later approved
- unattended approval accepts that root evidence when it matches the root commit
- evidence for a different commit is still rejected
- the prior manual-root-evidence test no longer gives false confidence by being
  the only coverage of the path

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/unattended-approval-policy.test.ts
pnpm -C packages/api build
pnpm -C packages/api exec vitest run src/tests/routes/approval-unattended.routes.test.ts
node scripts/check-file-size.mjs
git diff --check
```

Commit locally with a conventional commit subject and no attribution. Do not
push.
