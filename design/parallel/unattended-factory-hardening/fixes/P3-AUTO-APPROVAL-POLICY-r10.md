# Fix P3 - Reject Unknown Reviewed Commit Evidence

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P3-AUTO-APPROVAL-POLICY`

Authorized internal work. Do not push.

## Context

The automatic P3 fix loop hit its review-iteration cap after the r9-r4 review.
This is an explicit continuation task. Keep building on the latest P3 branch;
do not restart the feature from `main`.

## Required Branch Setup

Before editing source files, verify:

```sh
git merge-base --is-ancestor b1e90444 HEAD
```

The command must exit 0. If it exits non-zero, stop and report that branch setup
is missing. Do not create `.git-local`, do not reset the branch, and do not try
to bypass worktree git metadata. The orchestrator is responsible for pre-merging
`ductum/fix-P3-AUTO-APPROVAL-POLICY-r9-MJQzom` before implementation starts.

## Read First

- `design/parallel/unattended-factory-hardening/P3-AUTO-APPROVAL-POLICY.md`
- `design/parallel/unattended-factory-hardening/fixes/P3-AUTO-APPROVAL-POLICY-r9.md`
- `packages/core/src/post-completion-review-metadata.ts`
- `packages/core/src/post-completion-router-dispatch.ts`
- `packages/core/src/post-completion-router-route-review.ts`
- `packages/api/src/lib/runtime-approval-evidence.ts`
- `packages/api/src/index.ts`
- `packages/api/src/tests/routes/approval-unattended-review-race.test.ts`
- `packages/api/src/tests/routes/approval-unattended.routes.test.ts`

## Review Finding

The r9-r4 review failed with this blocking finding:

> `packages/core/src/post-completion-router-route-review.ts:44` and
> `packages/api/src/lib/runtime-approval-evidence.ts:19` stamp root review
> evidence with the root run's current commit whenever the review prompt lacks a
> parseable Reviewed Commit marker. That can happen for in-flight/legacy review
> tasks created before this change or any review task that lacks the marker;
> after route-review syncs the root to the current worktree HEAD, the callback
> calls `onReviewResult` with `undefined reviewedCommitSha`, and the API helper
> falls back to `run.commitSha`. A PASS for an older dispatched diff can
> therefore create current internal-review evidence on the approval root and
> satisfy unattended approval for a different commit. Root evidence should only
> be stamped with the explicitly reviewed commit, or the pass should
> refuse/carry non-current evidence when the reviewed commit is unknown.

## Task

Make review PASS evidence commit-strict.

Required behavior:

- A root `internal-review` approval evidence record must only be stamped with an
  explicitly reviewed commit SHA.
- If the reviewed commit is unknown or missing from the review metadata/prompt,
  do not fall back to the root run's current `commitSha`.
- An unknown-reviewed-commit PASS must not satisfy unattended approval for the
  current root commit.
- The normal current path with a valid reviewed commit marker must still pass.
- Keep existing root verification evidence behavior from r9; do not regress the
  fix-lineage verification evidence copy.

Prefer failing closed: either refuse to record root current review evidence for
unknown reviewed commits, or record it in a way that is visibly non-current and
cannot satisfy `evaluateUnattendedApproval`.

## Tests

Add focused tests that fail before the fix and pass after:

- a review PASS with missing/unknown reviewed commit does not satisfy unattended
  approval after the root worktree advances
- a review PASS with an explicit reviewed commit equal to the root commit still
  satisfies unattended approval
- the fix-lineage path still copies current root verification evidence for the
  fix commit
- existing stable-head approval tests remain green

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/unattended-approval-policy.test.ts
pnpm -C packages/api build
pnpm -C packages/api exec vitest run src/tests/routes/approval-unattended.routes.test.ts src/tests/routes/approval-unattended-review-race.test.ts
node scripts/check-file-size.mjs
git diff --check
```

Commit locally with a conventional commit subject and no attribution. Do not
push.
