# P3 - Auto Approval Policy

## Decision Trace

- D053/D166: Factory Settings own workflows, budgets, agents, sandboxes, and
  app settings.
- D054: Ductum coordinates; Edictum bounds tool and workflow gates.
- Operator policy for this stream: auto-approve/merge locally is allowed when
  workflow gates pass; push is allowed when the project workflow/policy permits
  it and CI/local verification is green.

## Behavior Contract

- [ ] Runtime must reject auto-approval unless project workflow gates,
  verification, valid review/judge result, budget compliance, and clean git
  state are all satisfied; evidence: policy unit/integration tests.
- [ ] Runtime must reject auto-push unless explicit workflow permission and green
  remote CI or a workflow-defined local substitute are present; evidence:
  API/CLI tests.
- [ ] Unknown CI, dirty worktree, conflicts, security flags, scope flags, or
  budget overage must stop as Needs Attention; evidence: stop-condition tests.
- [ ] Manual approval must remain available and must not be bypassed when policy
  is absent; evidence: existing approval tests still pass.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run src/tests/routes/approval*.test.ts src/tests/routes/merge*.test.ts
pnpm -C packages/cli build
pnpm -C packages/cli exec vitest run
node scripts/check-file-size.mjs
git diff --check
```

## Drift Handling

Record a decision before adding a new workflow policy field, public API shape,
or CI provider integration. Unknown CI is a blocker, not a pass.

## Slop Review

- [ ] Attack runtime behavior: can any accepted run merge/push without review,
  verification, workflow permission, and budget?
- [ ] Attack failure modes: unknown, skipped, pending, cancelled, or stale checks
  must not count as green.
- [ ] Attack missing or invalid inputs: protected branch, dirty worktree, conflict, or missing
  remote auth must stop loudly.

## Objective

Implement workflow-driven unattended approval, merge, and push policy without
weakening manual approval safety.

## Read first

- `packages/api/src/lib/run-ops/approval.ts`
- `packages/api/src/lib/run-ops/merge.ts`
- `packages/api/src/lib/run-ops/merge-finalize.ts`
- `packages/core/src/stale-approval.ts`
- `packages/core/src/approval-eligibility.ts`
- Workflow profile and factory settings types used by runs.
- P1 and P2 results.

## Allowed Scope

- Policy derivation, API/CLI controls, merge/push eligibility checks, status
  messages, tests.

## Non-goals

- Do not invent a second policy engine inside Ductum.
- Do not auto-push when workflow policy is absent.
- Do not hardcode Qratum-only commands; consume the project workflow.
- Do not bypass approval records or audit events.

## Implementation Notes

- Prefer an explicit `unattended` or auto-approval policy derivation from the
  workflow/factory settings rather than scattered booleans.
- Treat budget limits as hard gates using existing factory/spec budget state.
- Keep manual approval as the default for existing projects.

## Acceptance Criteria

- Auto-approval can merge and push only under explicit allowed policy with green
  verification and valid review.
- A rejected condition produces an operator-visible reason and recovery action.
- Approval, merge, push, and denial events remain auditable.

## Stop Conditions

- CI provider behavior is unclear and no local substitute is defined by the
  workflow.
- Any test proves manual approval got bypassed by default.
- Any secret value appears in logs, evidence, API JSON, or CLI output.
