# P3: Review/CI Reset + Approval Gates

**Scope:** Review/CI failure resets workflow; approval gate at external-review
**Package:** `packages/core`, `packages/api`
**Depends on:** P2 (Edictum as source of truth)
**Deliverable:** Review fail → reset to implement; approval gate blocks until human approves

---

## Required Reading

- `specs/impl-009-edictum-integration/spec.md` §Approval flow, §CI/review loop
- `edictum-harness/specs/m1/016-guarded-worker-lane.md` §Critical Semantics §2
- @edictum/core API: `runtime.reset(session, stageId)`, `runtime.recordApproval(session, stageId)`
- `packages/core/src/watchers/` — CI and review watcher implementations

## Tasks

### 1. Wire approval at external-review

The coding-guard workflow's `external-review` stage has an `approval` field.
When the workflow reaches this stage, @edictum/core blocks auto-advance
until `recordApproval(session, stageId)` is called.

Note: `recordApproval()` only records the approval. Stage advancement happens
during the next `evaluate()` call, which checks that approval is satisfied
and then advances the workflow.

Ductum wiring:
- Detect `state.pendingApproval.required === true` after evaluate()
- Emit `approval.requested` event → dashboard approval queue shows it
- `POST /api/runs/:id/approve` calls `runtime.recordApproval(session, 'external-review')`
  (stageId is required by the SDK)
- Next agent tool call triggers evaluate() which sees approval and advances

### 2. Wire review failure → reset

When review watcher detects findings:
1. Store findings as evidence on the run
2. Call `runtime.reset(session, 'implement')` — workflow goes backward
3. Run.stage updates to `implement` (read from workflow after reset)
4. `run.resetCount` increments
5. Agent receives findings in next prompt context

### 3. Wire CI failure → reset

Same pattern as review:
1. CI watcher detects failure
2. Store CI output as evidence
3. Reset to `implement` (compile error) or `local-verify` (test failure)
4. Run.stage updates, resetCount increments

### 4. Findings injection in agent prompt

When workflow is reset, include recent evidence in the agent's context.

### 5. Max reset limit

After N resets (configurable, default 5), mark run as failed.

## Verification

- [ ] External-review blocks until human approves in dashboard
- [ ] Review failure resets workflow to implement
- [ ] CI failure resets to implement or local-verify
- [ ] resetCount increments on each reset
- [ ] Agent receives failure findings after reset
- [ ] Max reset limit triggers run failure
