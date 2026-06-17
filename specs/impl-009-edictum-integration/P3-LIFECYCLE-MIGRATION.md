# P2: Edictum as Source of Truth

**Scope:** Run.stage reads from Edictum workflow; remove dual lifecycle
**Package:** `packages/core`, `packages/api`, `packages/harness`, `packages/dashboard`
**Depends on:** P1 (per-project workflows must be renderable)
**Deliverable:** One lifecycle system — Edictum owns stages, Ductum owns terminals

---

## Required Reading

- `specs/impl-009-edictum-integration/spec.md` §Architecture Decision
- `packages/core/src/state-machine.ts` — current RunStateMachine (~250 LOC to simplify)
- `packages/core/src/enforce.ts` — WORKFLOW_STAGE_BY_RUN_STAGE (to remove)
- `packages/core/src/types.ts` — RunStage type, Run interface
- `packages/api/src/lib/run-ops.ts` — completeRun, approveRun, failRun
- `packages/dashboard/src/pages/RunDetail.tsx` — stage display

## What Changes

### 1. RunStage type becomes WorkflowStage

```typescript
// BEFORE: 12 Ductum-owned stages
type RunStage = 'accepted' | 'implementing' | 'fixing' | 'pre-push-review' | ...

// AFTER: workflow stages + terminal states
type WorkflowStage = 'read-analyze' | 'create-branch' | 'baseline-verify' |
  'implement' | 'local-verify' | 'external-review' | 'docs-update' |
  'push-pr' | 'ci-green' | 'done'

type TerminalState = 'failed' | 'stalled'

interface Run {
  ...
  stage: WorkflowStage          // FROM Edictum (source of truth)
  terminalState: TerminalState | null  // Ductum-only
  resetCount: number
  ...
}
```

### 2. Remove WORKFLOW_STAGE_BY_RUN_STAGE

Delete the entire mapping in enforce.ts. No more translation layer.

### 3. Simplify RunStateMachine

Keep only:
- `markFailed(runId, reason)` — sets terminalState = 'failed'
- `markStalled(runId)` — sets terminalState = 'stalled'
- `markDone(runId)` — when workflow reaches 'done'
- `checkStalledRuns()` — heartbeat timeout detection

Remove:
- `transition()` — workflow handles stage progression
- `evaluateMergeGate()` — ci-green stage handles this
- `resolveLatch()` — no more parallel latches
- `VALID_TRANSITIONS` — workflow stage order IS the transition table
- `reset()` — workflow.reset() replaces this

### 4. Use data from BOTH evaluate() AND recordResult()

The Edictum SDK splits work between two calls:

- **`evaluate(session, envelope)`** — checks tool permission, updates
  blocked/allowed tracking. Returns `audit` snapshot. Does NOT record
  evidence or auto-advance.

- **`recordResult(session, stageId, envelope)`** — records tool evidence,
  checks exit gates, auto-advances if satisfied. Returns `events` array.
  (/Users/acartagena/project/edictum-ts/packages/core/src/workflow/runtime.ts:168)

Both produce dashboard-relevant data. The full enforcement flow:

```typescript
// Step 1: evaluate — is this tool allowed?
const evaluation = await runtime.evaluate(session, envelope)

// Update dashboard from audit snapshot (blocked reason, pending approval)
if (evaluation.audit) {
  const audit = evaluation.audit as WorkflowContext
  runRepo.updateWorkflowState(runId, {
    blockedReason: audit.blockedReason,
    pendingApproval: audit.pendingApproval,
    lastBlockedAction: audit.lastBlockedAction,
  })
}

if (evaluation.action !== 'allow') {
  return { allowed: false, reason: evaluation.reason }
}

// Step 2: tool executes (in harness — PreToolUse returns allow)

// Step 3: recordResult — AFTER successful execution (PostToolUse hook)
// This is where evidence is recorded and auto-advance happens
const events = await runtime.recordResult(session, currentStage, envelope)

// Step 4: refresh state AFTER recordResult — stages change HERE
const state = await runtime.state(session)
if (state.activeStage !== currentRun.stage) {
  runRepo.updateStage(runId, state.activeStage)
  eventEmitter.emit({ type: 'run.stage_changed', runId, from: old, to: state.activeStage })
}
runRepo.updateWorkflowState(runId, {
  completedStages: state.completedStages,
  pendingApproval: state.pendingApproval,
})

// Emit workflow events for SSE
for (const event of events) {
  eventEmitter.emit({ type: 'run.workflow_event', runId, event })
}
```

**Key: the state refresh and event emission MUST happen after recordResult(),
not just after evaluate(). The current recordToolSuccess() in enforce.ts
already calls recordResult() but does not refresh run state or emit events.
That is what causes the dashboard to lag behind auto-advancement.**

### 5. Store workflow state on the run

New fields on Run (or a separate workflow_state table):
```typescript
interface Run {
  ...
  stage: WorkflowStage           // refreshed after recordResult()
  completedStages: string[]      // refreshed after recordResult() (JSON column)
  blockedReason: string | null   // from evaluate() audit
  pendingApproval: boolean       // FROM audit.pendingApproval.required
  ...
}
```

### 6. Dispatcher creates runs at 'read-analyze'

```typescript
// BEFORE: stage: 'implementing'
// AFTER:  stage: 'read-analyze', terminalState: null
```

### 7. System prompt update

Remove "call gate_check implementing" instructions. Add:
```
The system enforces your workflow automatically. Start by reading the
required files. You cannot write code until you have read the context,
created a branch, and run baseline verification.
```

### 8. Dashboard reads workflow stages

RunDetail shows workflow stage names directly.
Stage badge color: read/branch/baseline = blue, implement = indigo,
verify/review = orange, push/ci = cyan, done = green.

### 9. Deprecate ductum_gate_check MCP tool

gate_check becomes a no-op that returns current workflow state.
Agents don't need to manually advance stages — auto-advance handles it.
Approval is human-only via dashboard, NOT agent-visible.

**Files to modify:**
- `packages/mcp/src/tools/enforcement.ts` (line ~6) — the tool definition
  and handler. Change handler to return `runtime.state(session)` only.
- `packages/mcp/src/api-client.ts` (line ~108) — the API client method
  that calls the backend. Simplify to just fetch state.
- `packages/api/src/routes/runs.ts` — the gate-check route handler.
  Change from state machine transition to workflow state read.
- `packages/core/src/enforce.ts` — `gateCheck()` method. Remove
  transition logic, return workflow state only.

## Schema Migration

SQLite does not support ALTER TABLE to change CHECK constraints. The `stage`
column currently has a CHECK that only allows old Ductum stages (accepted,
implementing, etc.). Writing workflow stages (read-analyze, implement, etc.)
would violate this constraint.

**Migration must rebuild the runs table:**

```sql
-- Migration: rebuild runs table with new stage CHECK
CREATE TABLE runs_new (
  -- copy all columns from runs, but change stage CHECK:
  ...
  stage TEXT NOT NULL DEFAULT 'read-analyze'
    CHECK (stage IN (
      'read-analyze', 'create-branch', 'baseline-verify', 'implement',
      'local-verify', 'external-review', 'docs-update', 'push-pr',
      'ci-green', 'done'
    )),
  terminal_state TEXT CHECK (terminal_state IN (NULL, 'failed', 'stalled')),
  reset_count INTEGER NOT NULL DEFAULT 0,
  completed_stages TEXT,  -- JSON array
  blocked_reason TEXT,
  pending_approval INTEGER NOT NULL DEFAULT 0,
  ...
);

-- Migrate existing rows, mapping old stages to new:
INSERT INTO runs_new SELECT
  ...,
  CASE stage
    WHEN 'accepted' THEN 'read-analyze'
    WHEN 'implementing' THEN 'implement'
    WHEN 'fixing' THEN 'implement'
    WHEN 'pre-push-review' THEN 'external-review'
    WHEN 'pushing' THEN 'push-pr'
    WHEN 'waiting-for-ci' THEN 'ci-green'
    WHEN 'waiting-for-review' THEN 'ci-green'
    WHEN 'waiting-for-approval' THEN 'external-review'
    WHEN 'merging' THEN 'done'
    WHEN 'done' THEN 'done'
    WHEN 'failed' THEN 'implement'  -- terminal_state handles failed
    WHEN 'stalled' THEN 'implement' -- terminal_state handles stalled
  END AS stage,
  CASE WHEN stage IN ('failed') THEN 'failed'
       WHEN stage IN ('stalled') THEN 'stalled'
       ELSE NULL END AS terminal_state,
  0 AS reset_count,
  NULL AS completed_stages,
  NULL AS blocked_reason,
  0 AS pending_approval,
  ...
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
-- Recreate indexes
```

Also rebuild `run_stage_history` to accept new stage values in from_stage/to_stage.

## Verification

- [ ] Run.stage shows workflow stages (read-analyze, implement, etc.)
- [ ] No WORKFLOW_STAGE_BY_RUN_STAGE mapping exists
- [ ] RunStateMachine has only markFailed/markStalled/markDone/checkStalled
- [ ] Agent starts at read-analyze, auto-advances to implement after reading
- [ ] Dashboard shows workflow stage names
- [ ] Failed/stalled are terminalState, separate from stage
- [ ] Old VALID_TRANSITIONS and latch system removed
