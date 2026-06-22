# Fix P3 - Stamp Runtime Approval Evidence

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P3-AUTO-APPROVAL-POLICY`
Branch/worktree: this task may start on a fresh Ductum repair branch. Before
editing, merge the existing P3 stream branch into the current repair branch.

Authorized internal work. Do not push.

## Read first

- `design/parallel/unattended-factory-hardening/P3-AUTO-APPROVAL-POLICY.md`
- `packages/core/src/unattended-approval-policy.ts`
- `packages/api/src/index.ts`
- `packages/api/src/lib/run-ops/approval.ts`
- `packages/api/src/lib/run-ops/merge.ts`
- `packages/api/src/tests/routes/approval-unattended.routes.test.ts`
- Any existing tests for runtime verification/review result evidence.

## Required branch setup

Before editing source files, run and verify:

```sh
git merge --no-edit ductum/P3-AUTO-APPROVAL-POLICY-scIlW9
git merge-base --is-ancestor aa6c3697 HEAD
```

The second command must exit 0. If the merge conflicts, resolve only conflicts
needed to preserve both the existing stream code and this repair. Do not reset
or drop the P3 stream work. Do not continue on a branch that lacks `aa6c3697`.

## Problem

The r6 review found a real blocking bug in unattended approval freshness:

- `packages/api/src/index.ts` creates runtime `onVerificationResult` and
  `onReviewResult` evidence without `commitSha`.
- `packages/core/src/unattended-approval-policy.ts` treats commitless evidence
  as current only when `evidence.createdAt >= run.updatedAt`.
- In the normal flow, the runtime records verification/review evidence before
  `onReadyToShip` advances the run and updates `run.updatedAt`.

That means valid post-completion verification/review evidence can be ignored as
stale, causing unattended approval to block with reasons like:

- `structured verification evidence has not passed`
- `valid review/judge result has not passed`

This defeats the actual workflow-driven unattended approval path.

## Task

Make runtime-created verification/review evidence usable by unattended approval
without weakening stale-evidence protection.

Recommended fix:

- Stamp the runtime callback evidence payloads with the run commit when a commit
  exists.
- Keep the policy strict: evidence for another commit must not count.
- Keep commitless fallback behavior only for legacy/no-commit cases.

If a different freshness fix is chosen, document why it still rejects stale
evidence from older commits and covers the normal runtime callback path.

## Out of scope

- Do not change merge policy semantics beyond this freshness issue.
- Do not make dirty/conflicted/security/scope flags less strict.
- Do not bypass required verification/review evidence.
- Do not push.

## Tests

Add focused coverage that fails before the fix and passes after:

- runtime callback verification evidence recorded before ship-stage advancement
  still satisfies unattended approval for the same commit
- runtime callback review/judge evidence recorded before ship-stage advancement
  still satisfies unattended approval for the same commit
- stale evidence for a different commit is still rejected

Prefer integration-level API/run-op tests if they already exist near this
surface; otherwise add the smallest core/API test that proves the production
path.

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
