# Fix P3 - Block Generic Internal Review Commit Enrichment

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P3-AUTO-APPROVAL-POLICY`

Authorized internal work. Do not push.

## Context

P3 r10 made runtime review callbacks commit-strict. Review then found the
generic evidence route can still mint current `internal-review` evidence without
an explicit reviewed commit. This task fixes that public evidence path.

## Required Branch Setup

Before editing source files, verify:

```sh
git merge-base --is-ancestor ca1f531d HEAD
```

The command must exit 0. If it exits non-zero, stop and report that branch setup
is missing. Do not create `.git-local`, do not reset the branch, and do not try
to bypass worktree git metadata. The orchestrator is responsible for pre-merging
`ductum/fix-P3-AUTO-APPROVAL-POLICY-r10-CWKKpl` before implementation starts.

## Read First

- `design/parallel/unattended-factory-hardening/P3-AUTO-APPROVAL-POLICY.md`
- `design/parallel/unattended-factory-hardening/fixes/P3-AUTO-APPROVAL-POLICY-r10.md`
- `packages/api/src/lib/run-ops/evidence.ts`
- `packages/api/src/routes/runs.ts`
- `packages/api/src/lib/runtime-approval-evidence.ts`
- `packages/api/src/tests/routes/approval-unattended-review-race.test.ts`
- `packages/api/src/tests/routes/approval-unattended.routes.test.ts`

## Review Finding

The r10 review failed with this blocking finding:

> `packages/api/src/lib/run-ops/evidence.ts:13-16` auto-adds the run's current
> `commitSha` to every evidence payload that lacks `commitSha`, and
> `packages/api/src/routes/runs.ts:445-462` allows custom
> `payload.kind='internal-review'` through that helper. A caller can POST an
> `internal-review` PASS without any explicit reviewed commit and have it
> stamped as current root evidence, which violates the requirement that root
> internal-review approval evidence only be stamped with an explicitly reviewed
> commit SHA and can satisfy `evaluateUnattendedApproval` when paired with
> current verify evidence. Exclude `internal-review` from generic commit
> enrichment or require/validate an explicit reviewed commit for that kind.

## Task

Make the generic evidence path fail closed for `internal-review`.

Required behavior:

- Generic evidence creation must not auto-fill `commitSha` for
  `payload.kind === 'internal-review'`.
- An `internal-review` PASS submitted without an explicit reviewed/current
  commit must not satisfy unattended approval.
- A valid runtime callback path with explicit reviewed commit metadata must
  still satisfy unattended approval.
- Do not weaken verification evidence enrichment.
- Keep the r10 runtime callback behavior unchanged.

Prefer a narrow API/core helper change plus tests. Do not redesign evidence
storage.

## Tests

Add focused tests that fail before the fix and pass after:

- POSTing custom `internal-review` PASS evidence without `commitSha` does not
  get enriched with the run's current commit and does not satisfy unattended
  approval
- POSTing normal verification evidence still gets existing commit enrichment
  when appropriate
- the runtime review callback path with explicit reviewed commit remains green
- existing stale-HEAD review race tests remain green

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
