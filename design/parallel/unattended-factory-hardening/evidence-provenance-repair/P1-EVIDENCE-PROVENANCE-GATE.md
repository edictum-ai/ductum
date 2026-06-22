# P1 - Evidence Provenance Gate

## Decision Trace

- Continue the failed P3 auto-approval branch from local branch
  `ductum/p3-evidence-provenance-repair`, which points at `5268b799195eee52bb092c3643062385d77dfc4e`.
- Review `1BCXOxAvlqvv` failed because an implementing agent can post raw
  successful `review`, `ci`, `test`, or `lint` evidence through the evidence
  route and satisfy unattended approval gates.
- P3 still requires valid review/judge, verification, CI/local substitute,
  budget, and clean git evidence before unattended merge/push.

## Behavior Contract

- [ ] REJECTS or de-trusts agent-submitted successful `review`, `ci`, `test`,
  `lint`, and `verify` evidence for unattended approval; evidence:
  policy/API regression tests.
- [ ] Runtime still accepts Ductum-produced review/CI/verification evidence from
  trusted producer paths; evidence: existing approval and watcher tests.
- [ ] FAILS if `ductum_evidence` can forge every unattended gate for the current
  commit; evidence: exploit regression test.
- [ ] Manual approval still works when unattended evidence is absent or
  untrusted; evidence: approval route tests.

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

- Unknown evidence provenance blocks unattended approval.
- Do not add a public trusted-producer claim unless tests prove how the
  producer is distinguished from an agent-submitted route call.
- Preserve manual approval, explicit denial, and audit evidence.

## Slop Review

- [ ] Attack evidence provenance: can the bound implementing agent forge review,
  CI, or verification success through MCP or REST evidence?
- [ ] Attack duplicate/routing logic: does trusted evidence come only from
  runtime/watcher paths, not generic route payloads?
- [ ] Attack behavior contract: every trusted and untrusted evidence path has a
  test.

## Objective

Fix the P3 approval evidence trust boundary so unattended approval cannot be
satisfied by self-attested agent evidence.

## Read First

- `packages/core/src/unattended-approval-policy.ts`
- `packages/api/src/routes/runs.ts`
- `packages/mcp/src/tools/evidence.ts`
- `packages/api/src/lib/runtime-approval-evidence.ts`
- `packages/core/src/post-completion-router-route-review.ts`
- `packages/core/src/post-completion-review-metadata.ts`
- `packages/api/src/tests/routes/approval-unattended.routes.test.ts`
- `packages/api/src/tests/routes/approval-unattended-review-race.test.ts`
- Review output from run `1BCXOxAvlqvv`.

## Allowed Scope

- Continue from branch `ductum/p3-evidence-provenance-repair`.
- Core approval policy, API evidence-route sanitization/validation, MCP evidence
  behavior if needed, and focused tests.
- Minor cleanup directly needed to keep touched files under 300 LOC.

## Non-goals

- Do not push.
- Do not weaken manual approval.
- Do not trust generic custom evidence, raw route evidence, or agent text as a
  review/CI/verification producer.
- Do not add a new top-level workflow primitive unless a decision is recorded.

## Implementation Notes

1. After reading the required files, check out
   `ductum/p3-evidence-provenance-repair`.
2. Stop if the branch is unavailable, checked out somewhere unsafe, dirty, or
   cannot be continued cleanly.
3. Treat the exploit described by review `1BCXOxAvlqvv` as the primary failing
   test: agent-posted `review`/`ci`/`test`/`lint`/`verify` success must not
   satisfy unattended approval.
4. Prefer a small explicit provenance marker or route-level rejection over a
   broad rewrite. The policy must distinguish trusted runtime/watcher evidence
   from agent-submitted evidence.

## Acceptance Criteria

- A regression test proves forged agent evidence no longer unlocks unattended
  approval.
- Existing trusted runtime review evidence still unlocks review when valid and
  commit-fresh.
- Existing manual approval and denial flows still pass.
- Full core/api/cli verification and file-size gates pass.

## Stop Conditions

- The continuation branch cannot be checked out or has unrelated dirty changes.
- You cannot identify a principled trust boundary between runtime/watcher
  evidence and agent-posted evidence.
- Any security-sensitive evidence now silently disappears instead of producing
  an operator-visible block reason.
