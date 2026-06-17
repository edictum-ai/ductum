# impl-009: Edictum as the Governance Layer

**Status:** Draft (revision 2 — addresses review findings, resolves dual-lifecycle problem)
**Priority:** Critical — this is the product thesis
**Depends on:** None (absorbs impl-004 — exit condition matching is now P1 of this spec)
**Absorbed:** impl-004 (workflow completion) — P1 condition matching + P2 completion/DB persistence
**Sources:** edictum-harness specs 008, 010, 013, 016

## The Thesis

> Edictum is what makes the category claim defensible. Without Edictum, Ductum
> risks being heard as "yet another orchestration layer." With Edictum, the story
> becomes: this is not just agent dispatch; this is enforced software production
> governance for AI workers.

Ductum = software work orchestration.
Edictum = non-bypassable workflow governance.

Right now, Edictum is a tool allowlist. This spec makes it the governance layer.

## Problem

Ductum maintains two parallel lifecycle systems:

1. **Ductum RunStateMachine** — 12 stages, custom transition table, parallel
   latches, manual gate logic (packages/core/src/state-machine.ts, ~250 LOC)
2. **@edictum/core WorkflowRuntime** — 10 stages, evidence-based auto-advance,
   condition matching, approval gates (embedded but barely used)

These fight each other:
- `WORKFLOW_STAGE_BY_RUN_STAGE` translates between them (always wrong)
- `syncWorkflowStage` tries to keep them aligned (always drifts)
- The dashboard reads Ductum stages; the enforcement reads Edictum stages
- Gates exist in both systems with different semantics

Beyond the dual-lifecycle problem, we're throwing away rich data that
@edictum/core already computes:

**From `evaluate()` — thrown away every tool call:**
- `audit`: full workflow snapshot (active stage, completed stages, blocked reason,
  pending approvals, last blocked action, last evidence) — this IS the dashboard data
- `events`: stage advancement events (what changed and why)
- `records`: evidence records produced by the evaluation
- `stageId`: which stage was evaluated

**From `state()` — barely read:**
- `completedStages`: progress through the workflow (dashboard could show 4/10)
- `evidence.reads`: which files the agent has read (required reads tracking)
- `evidence.stageCalls`: tool calls per stage (audit trail)
- `blockedReason`: WHY the agent was blocked (dashboard should show this)
- `pendingApproval`: is approval needed right now? which stage? what message?
- `lastBlockedAction`: last tool that was denied (tool, summary, message, timestamp)
- `lastRecordedEvidence`: last successful evidence (tool, summary, timestamp)

**Not called at all:**
- `recordApproval(session, stageId)`: approval gate resolution
- `reset(session, stageId)`: backward movement on review/CI failure
- `evaluateWorkflowGates(session, stageId)`: check if gates are satisfied

The fix is not better mapping. The fix is **one system** that uses all of this.

## Architecture Decision

**Edictum's workflow IS the run lifecycle.** Ductum's state machine is reduced
to three concerns it actually owns:

| Ductum owns | Edictum owns |
|-------------|-------------|
| Dispatch (agent selection, worktree, spawn) | Stage progression (read → branch → implement → verify → review → push → ci → done) |
| DAG (task dependencies, cascade) | Tool authorization per stage |
| Terminal states (failed, stalled) | Evidence requirements and auto-advance |
| Retry logic | Approval gates (external-review) |
| Cost/token tracking | Stage reset on review/CI failure |
| Activity feed | What the agent can and cannot do at any moment |

### What this means concretely

#### Run.stage becomes a read from Edictum

```typescript
// BEFORE: Ductum's state machine owns the stage
run.stage = stateMachine.transition(runId, 'pre-push-review')

// AFTER: stage is the workflow's active stage
run.stage = await workflowRuntime.state(session).activeStage
// Plus: run.terminalState = 'failed' | 'stalled' | null (Ductum-only)
```

#### RunStateMachine gets simplified

Remove:
- `VALID_TRANSITIONS` table (Edictum's stage order IS the transition table)
- `evaluateMergeGate()` (Edictum's ci-green exit conditions handle this)
- `resolveLatch()` (CI/review are Edictum stages, not parallel latches)
- `transition()` for most stages (workflow auto-advances)

Keep:
- `markStalled(runId)` — heartbeat timeout (Ductum concern)
- `markFailed(runId, reason)` — session crash (Ductum concern)
- `markDone(runId)` — when workflow reaches `done` stage

#### EnforcementManager becomes per-project

```typescript
// BEFORE: one global workflow
constructor(options: { workflowPath: string, ... })

// AFTER: per-project workflow from rendered profile
constructor(options: { 
  workflowDefs: Map<ProjectId, WorkflowDefinition>,
  ...
})
```

At startup, for each project with a workflow profile:
1. Read `.edictum/workflow-profile.yaml` from the repo
2. Render concrete workflow from template + profile
3. Store as per-project WorkflowDefinition

At dispatch, the run gets the project's workflow definition.

#### Dashboard reads Edictum state directly

The stage strip / workflow indicator shows Edictum's stages:

```
read-analyze → create-branch → baseline-verify → [implement] → local-verify → ...
                                                      ↑
                                                  ACTIVE NOW
```

No translation layer. The dashboard queries:
```
GET /api/runs/:id → { stage: 'implement', terminalState: null, ... }
```

Where `stage` comes directly from `workflowRuntime.state(session).activeStage`.

### Repo profiles (from edictum-harness spec 013)

Per-repo config at `.edictum/workflow-profile.yaml`:

```yaml
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: ductum
context:
  required_files: [README.md, CLAUDE.md]
verify:
  commands: [pnpm build, pnpm -r test]
push:
  protected_branches: [main]
```

**ductum.yaml** references the profile:
```yaml
projects:
  ductum:
    repos:
      - path: /Users/acartagena/project/ductum
        name: ductum
    workflow:
      profile: .edictum/workflow-profile.yaml
```

**Renderer** produces concrete workflow at startup by substituting profile
values into the template (`workflows/coding-guard-template.yaml`).

### Stage → Ductum run stage mapping

The run's `stage` field is set FROM Edictum, not mapped TO Edictum:

```typescript
// On every tool authorization or status check:
const workflowState = await runtime.state(session)
runRepo.updateStage(runId, workflowState.activeStage)
```

For terminal states (Ductum-only):
```typescript
run.terminalState = null          // normal — stage from workflow
run.terminalState = 'failed'      // session crashed or max retries
run.terminalState = 'stalled'     // heartbeat timeout
```

Dashboard display:
- `terminalState == null` → show workflow stage with progress
- `terminalState == 'failed'` → show FAILED badge
- `terminalState == 'stalled'` → show STALLED badge + retry button

### Approval flow

Edictum's `external-review` stage has an `approval` field in the workflow YAML.
When the workflow reaches this stage:
1. Edictum blocks further advancement until approval is recorded
2. Ductum detects `state.pendingApproval.required === true` → emits
   `approval.requested` event → dashboard shows in approval queue
3. Human approves via dashboard → Ductum calls
   `runtime.recordApproval(session, 'external-review')` (stageId required)
4. Next `evaluate()` call checks approval is satisfied and advances the workflow
   (recordApproval only records — advancement happens during the next evaluate())

No separate `waiting-for-approval` Ductum stage. The workflow IS the approval system.

### CI/review loop (spec 016 reset semantics)

When CI or review fails:
1. Watcher posts findings as evidence
2. Ductum calls `runtime.reset(session, 'implement')` — workflow goes backward
3. Run's `stage` updates to `implement` (read from workflow)
4. `run.resetCount` increments
5. Agent receives findings in prompt context
6. Agent re-codes, re-verifies, workflow progresses forward again

### System prompt changes

Remove:
```
"Your FIRST action must be to advance to the implementing stage."
"Call ductum_gate_check with target_stage='implementing'"
```

Replace:
```
"The system enforces your workflow automatically. Start by reading the
required files. You cannot write code until you have read the context,
created a branch, and run baseline verification. The system advances
you through stages as you complete each one.

Stages: read → branch → baseline-verify → implement → test → review → docs → push → CI → done"
```

## Migration Path

This is a significant refactor. The migration should be phased:

### Phase 1: Exit condition matching (P1, absorbed from impl-004)
- Fix absolute path → basename normalization in recordToolSuccess
- Auto-advance works: reading README.md advances past read-analyze
- DB persistence: --reset flag, idempotent migrations

### Phase 2: Per-project workflow rendering (P2)
- Add repo profiles + renderer
- EnforcementManager accepts per-project defs
- No lifecycle changes yet

### Phase 3: Edictum as source of truth (P3)
- Run.stage reads from workflow state
- Remove WORKFLOW_STAGE_BY_RUN_STAGE mapping
- Simplify RunStateMachine to terminal states only
- Update dashboard to show workflow stages
- Update system prompt

### Phase 4: Review/CI reset + approval (P4)
- Wire reset semantics (review fail → reset to implement)
- Wire approval gate (external-review approval field)
- Findings injection in prompt

### Phase 5: Structured completion + cleanup (P5)
- Structured completion data from agents
- Completion storage (absorbed from impl-004/P2)
- Remove dead code from old state machine
- Full test coverage of new lifecycle

## Schema Changes

### Run table changes

```sql
-- New fields
ALTER TABLE runs ADD COLUMN terminal_state TEXT
  CHECK (terminal_state IN (NULL, 'failed', 'stalled'));
ALTER TABLE runs ADD COLUMN reset_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN completion_data TEXT;  -- JSON

-- Stage field stays but is now written from Edictum, not RunStateMachine
-- Remove: ci_status, review_status (Edictum stages handle this)
-- Keep for now but deprecate: ci_status, review_status (dashboard may still read them)
```

### Files to modify

| File | Change |
|------|--------|
| packages/core/src/state-machine.ts | Reduce to terminal states only |
| packages/core/src/enforce.ts | Per-project defs, remove stage mapping, use audit/events from evaluate() |
| packages/core/src/dispatcher.ts | Pass project workflow to enforcement |
| packages/core/src/dispatcher-support.ts | System prompt — remove gate_check instructions |
| packages/core/src/types.ts | Run gains terminalState, resetCount, completedStages, blockedReason, pendingApproval, completionData. RunStage type replaced with WorkflowStage. |
| packages/core/src/db.ts | Rebuild runs table (CHECK constraint change), new migrations |
| **packages/api/src/index.ts** | **Per-project workflow loading (currently line ~57 loads one global workflow). This is the wiring point — EnforcementManager must receive per-project WorkflowDefinitions here.** |
| packages/api/src/routes/runs.ts | Expose workflow state, handle approval via recordApproval(session, stageId) |
| packages/api/src/lib/run-ops.ts | completeRun reads from workflow, approveRun calls recordApproval(session, stageId) |
| packages/harness/src/claude.ts | System prompt update, remove gate_check-first pattern |
| packages/mcp/src/server.ts | gate_check becomes no-op returning workflow state |
| packages/dashboard/src/pages/RunDetail.tsx | Show workflow stages, pendingApproval panel |
| **packages/dashboard/src/pages/ApprovalQueue.tsx** | **Filter by pendingApproval field, not old waiting-for-approval stage** |
| scripts/serve.mjs | Load profiles per project, render workflows, pass to API |
| workflows/coding-guard-template.yaml | New template with variables |
| .edictum/workflow-profile.yaml | New repo profile for ductum itself |

## Acceptance Criteria

1. Run.stage comes from @edictum/core workflow state, not RunStateMachine
2. Each project can have a workflow profile with custom verify commands
3. Agents progress through all 10 stages automatically (auto-advance works)
4. Tool authorization comes from the active workflow stage (no mapping)
5. `git push` during `implement` is blocked; `git push` during `push-pr` is allowed
6. Approval gate works: external-review blocks until human approves in dashboard
7. Review failure resets workflow to `implement`, increments resetCount
8. Dashboard shows workflow stage progression (not the old 7-stage stepper)
9. Failed/stalled are Ductum-only terminal states (session crash, heartbeat)
10. Old RunStateMachine transition table and latch system removed

## Decisions

- D37: Edictum workflow IS the run lifecycle — one source of truth
- D38: Ductum only owns terminal states (failed, stalled) and orchestration (dispatch, DAG, retry)
- D39: Run.stage is a read from workflowRuntime.state().activeStage
- D40: Repo profiles follow edictum-harness spec 013 format
- D41: Review/CI failure uses workflow reset (spec 016), not Ductum state machine
- D42: Approval uses Edictum's recordApproval, not a separate Ductum approval system
- D43: RunStateMachine reduced to markFailed/markStalled/markDone only
