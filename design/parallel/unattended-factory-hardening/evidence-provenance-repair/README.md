# P3 Evidence Provenance Repair

Goal: finish P3 after the review failure on `1BCXOxAvlqvv` by preventing
agent-posted evidence from satisfying unattended approval gates.

## Decision Trace

- D053/D166: Factory Settings own workflows, budgets, agents, sandboxes, and
  approval policy.
- P3 requires workflow-gated unattended approval with valid review/judge,
  verification, budget, and clean git evidence.
- Review `1BCXOxAvlqvv` failed P3 because route-posted `review`, `ci`, `test`,
  and `lint` evidence can be forged by the bound implementing agent.

## Behavior Contract

- [ ] REJECTS or de-trusts agent-submitted successful `review`, `ci`, `test`,
  `lint`, and `verify` evidence for unattended approval; evidence: API/policy
  regression tests.
- [ ] Runtime still accepts system-produced review/CI/verification evidence from
  trusted Ductum paths; evidence: existing approval and watcher tests.
- [ ] FAILS if an implementing agent can satisfy all unattended gates by calling
  `ductum_evidence`; evidence: exploit regression test.
- [ ] Manual approval remains available and audited when unattended evidence is
  missing or untrusted; evidence: approval route tests.

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

- Do not add a new public evidence producer concept without tests showing which
  producer is trusted.
- Unknown provenance blocks unattended approval; it must not silently pass.
- If branch continuation from the failed P3 branch cannot be done safely, stop
  and report the exact git blocker.

## Slop Review

- [ ] Attack evidence provenance: can a bound agent forge a review, CI, or
  verification pass through MCP or the REST route?
- [ ] Attack routing logic: do watcher/runtime-produced evidence paths still
  work without trusting raw agent evidence?
- [ ] Attack behavior contract: every pass condition has explicit tests and no
  hidden manual judgment.

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-EVIDENCE-PROVENANCE-GATE.md](P1-EVIDENCE-PROVENANCE-GATE.md) | core/api/cli | approval evidence trust | unforgeable unattended approval evidence | [ ] | - |
