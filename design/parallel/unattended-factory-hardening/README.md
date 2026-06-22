# Unattended Factory Hardening

Goal: make Ductum genuinely capable of unattended local dogfood, then prove it
with a real Ductum-managed Qratum burn-in.

This package is intentionally scoped to the gaps that still block that claim:
durable lifecycle truth, strict review contracts, workflow-gated approval/push,
provider/harness doctor checks, real Podman agent execution, bakeoff stats, and
a final burn-in that leaves the factory clean.

## Decision Trace

- D053: Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt is
  the accepted operator model.
- D054/D057: harnesses are adapters; Ductum owns orchestration, state, policy
  routing, and recovery.
- D056/D172: sandboxing is a first-class resource. D172 shipped the Podman
  driver but explicitly left agent execution inside the container as a
  follow-up.
- D166: post-P9 operational model closeout is accepted; this is hardening, not a
  redesign rollback.
- D173: `whatToDoNext` and quarantine are the durable operator-legibility source.

## Behavior Contract

- [ ] FAILS if an accepted completion can leave a ghost active run or hide a
  failed child review; evidence: core/API/CLI regression tests plus live
  `ductum status`.
- [ ] Runtime must reject or quarantine malformed reviewer/judge outputs with an
  operator-visible recovery path; evidence: core post-completion tests and
  bakeoff compare output.
- [ ] Auto-approval, merge, and push must be workflow-gated, budget-gated, and
  CI/local-verification-gated; evidence: policy tests and a burn-in audit.
- [ ] Podman unattended mode must run the agent process inside the prepared
  container, not merely preflight an envelope; evidence: env-gated real Podman
  integration proof.

## Verification

Each prompt lists its own narrow verification. Before the final burn-in can be
accepted, run and report:

```sh
pnpm build
pnpm -C packages/core exec vitest run
pnpm -C packages/api exec vitest run
pnpm -C packages/cli exec vitest run
node scripts/check-file-size.mjs
git diff --check
rg -n "tryReattach|ORPHANED_|reattach" packages
```

The final proof must also include live Ductum CLI output for factory status,
provider doctor, bakeoff stats, Podman execution, and Qratum burn-in cleanup.

## Drift Handling

- Record a decision before adding a new top-level primitive, workflow semantic,
  dependency, public auth shape, or secret storage behavior.
- Do not bypass Edictum gates or duplicate policy logic in Ductum.
- If a task needs manual operator input, expose it as Needs Attention or a
  pending approval, not as an active run.
- If CI status cannot be read, unknown CI blocks unattended push.

## Slop Review

- [ ] Attack runtime behavior: can any run remain active after completion,
  terminal failure, review failure, or approval?
- [ ] Attack runtime behavior: can an empty/malformed judge result disappear
  without Needs Attention?
- [ ] Attack runtime behavior: can Ductum merge or push without the project
  workflow gates, budget, and verification proving it should?
- [ ] Attack explicit evidence: does the evidence prove agent side effects ran in
  Podman, not only that Podman exists?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-LIFECYCLE-STATUS-REPAIR.md](P1-LIFECYCLE-STATUS-REPAIR.md) | core/api/cli | completion, review failure, status truth | no ghost active runs; failed reviews visible | [ ] | - |
| 2 | [P2-STRUCTURED-REVIEW-CONTRACT.md](P2-STRUCTURED-REVIEW-CONTRACT.md) | core/api/harness | reviewer and judge output contract | validated structured result handling | [ ] | P1 |
| 3 | [P3-AUTO-APPROVAL-POLICY.md](P3-AUTO-APPROVAL-POLICY.md) | core/api/cli | workflow-gated approval, merge, push | unattended policy gate | [ ] | P1, P2 |
| 4 | [P4-PROVIDER-HARNESS-DOCTOR.md](P4-PROVIDER-HARNESS-DOCTOR.md) | core/api/cli | model route/env/token/harness checks | provider doctor proof including GLM 5.2 | [ ] | P1 |
| 5 | [P5-PODMAN-AGENT-EXECUTION.md](P5-PODMAN-AGENT-EXECUTION.md) | core/harness/api | run agent side effects inside Podman | honest container execution | [ ] | P1 |
| 6 | [P6-BAKEOFF-STATS-MATRIX.md](P6-BAKEOFF-STATS-MATRIX.md) | api/cli/dashboard | durable bakeoff stats and matrix proof | cost/time/token/outcome stats | [ ] | P1, P2, P4 |
| 7 | [P7-BURN-IN-UNATTENDED-RUN.md](P7-BURN-IN-UNATTENDED-RUN.md) | factory/qratum | real unattended Qratum proof | clean burn-in completion | [ ] | P1, P2, P3, P4, P5, P6 |
