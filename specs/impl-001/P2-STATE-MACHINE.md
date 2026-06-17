# P2: Run State Machine + @edictum/core Integration

**Scope:** Run state machine, authorize_tool, gate_check, workflow YAML, @edictum/core integration
**Package:** `packages/core`
**Depends on:** P1 (types, repos, DB)
**Deliverable:** RunStateMachine class, enforcement module, coding-guard.yaml workflow
**Verification:** `cd packages/core && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §6 (Run State Machine), §7 (Enforcement Model)
- `ARCHITECTURE.md` §Run state machine (full diagram with parallel latches)
- `decisions/006-round-3-final.md` §C1 (authorize_tool vs gate_check), §C2 (reset authority), §C3 (session binding)
- `decisions/005-round-2-response.md` §D16 (parallel latches), §D17 (fixing vs implementing)
- `HARNESS.md` §Enforcement boundary
- `edictum-ts/packages/core/src/workflow/runtime.ts` — WorkflowRuntime API
- `edictum-ts/packages/core/src/workflow/definition.ts` — WorkflowDefinition, WorkflowStage
- `edictum-ts/packages/core/src/runner.ts` — run() function, tool-call governance
- `edictum-ts/packages/core/src/storage.ts` — StorageBackend interface (4 methods: get/set/delete/increment)
- `edictum-ts/packages/core/src/session.ts` — Session class (handles key namespacing, NOT the backend)
- `edictum-ts/packages/core/src/tool-call.ts` — createEnvelope

## Shared Modules (import from P1)

| What | Where |
|------|-------|
| All types | `packages/core/src/types.ts` |
| RunRepo, RunStageHistoryRepo | `packages/core/src/repos/run.ts` |
| GateEvaluationRepo | `packages/core/src/repos/evidence.ts` |
| SessionRunMappingRepo | `packages/core/src/repos/session.ts` |
| createId | `packages/core/src/types.ts` |

## Tasks

### 1. Define valid transitions table

File: `packages/core/src/state-machine.ts`

Define the valid transition map as a constant:

```typescript
const VALID_TRANSITIONS: Record<RunStage, RunStage[]> = {
  'accepted':              ['implementing'],
  'implementing':          ['pre-push-review', 'failed'],
  'fixing':                ['pre-push-review', 'failed'],
  'pre-push-review':       ['pushing', 'fixing'],
  'pushing':               ['waiting-for-ci', 'waiting-for-review'],
  'waiting-for-ci':        [],  // resolved by latch, not direct transition
  'waiting-for-review':    [],  // resolved by latch, not direct transition
  'waiting-for-approval':  ['merging'],
  'merging':               ['done', 'failed'],
  'done':                  [],
  'failed':                ['implementing', 'fixing'],  // only via Ductum Core reset
  'stalled':               ['implementing', 'fixing'],  // only via resume
}
```

Note: transitions from `pushing` to both `waiting-for-ci` AND `waiting-for-review` happen atomically as parallel latch entry. Transitions out of `waiting-for-*` are latch resolution, not direct transitions.

### 2. Implement RunStateMachine class

File: `packages/core/src/state-machine.ts`

```typescript
class RunStateMachine {
  constructor(
    private runRepo: RunRepo,
    private stageHistoryRepo: RunStageHistoryRepo,
    private gateEvaluationRepo: GateEvaluationRepo,
    private eventEmitter: EventEmitter,  // SSE events
  )

  // Validate and execute a stage transition
  transition(runId: RunId, targetStage: RunStage, reason?: string): Run

  // Enter parallel latch state (from pushing)
  enterParallelLatches(runId: RunId): Run

  // Resolve a parallel latch (ci or review)
  resolveLatch(runId: RunId, latch: 'ci' | 'review', status: 'pass' | 'fail'): Run

  // Check if both latches are resolved and evaluate merge gate
  evaluateMergeGate(runId: RunId, mergeMode: 'auto' | 'human'): Run

  // Reset a run to a target stage (Ductum Core only, not agent-callable)
  reset(runId: RunId, targetStage: 'implementing' | 'fixing', reason: string): Run

  // Mark run as stalled (heartbeat timeout)
  markStalled(runId: RunId): Run

  // Resume a stalled run (new session)
  resume(runId: RunId, targetStage: 'implementing' | 'fixing'): Run

  // Record heartbeat
  heartbeat(runId: RunId): void

  // Check for stalled runs
  checkStalledRuns(): Run[]
}
```

Key behaviors:
- `transition()` validates against VALID_TRANSITIONS, throws on invalid
- `transition()` records in run_stage_history with timestamp and reason
- `enterParallelLatches()` sets ci_status and review_status to 'pending' and transitions to waiting-for-ci (the run's stage field tracks the "primary" wait; both latches are tracked via ci_status/review_status columns)
- `resolveLatch()` updates ci_status or review_status. If the latch fails, calls `reset(runId, 'fixing', reason)`. If both pass, calls `evaluateMergeGate()`.
- `evaluateMergeGate()` checks merge mode: auto -> transitions to merging; human -> transitions to waiting-for-approval
- All transitions emit SSE events via eventEmitter
- `checkStalledRuns()` queries runs where last_heartbeat < now - heartbeat_timeout_seconds

### 3. Implement @edictum/core StorageBackend adapter (D28)

File: `packages/core/src/edictum-storage.ts`

@edictum/core's StorageBackend is 4 methods. It is NOT session-aware — Session handles key namespacing internally by prefixing keys with `s:{sessionId}:`. The adapter just stores and retrieves by key.

```typescript
import type { StorageBackend } from '@edictum/core'

class SqliteStorageBackend implements StorageBackend {
  constructor(private db: Database)

  async get(key: string): Promise<string | null>
  async set(key: string, value: string): Promise<void>
  async delete(key: string): Promise<void>
  async increment(key: string, amount?: number): Promise<number>

  // Optional: Session feature-detects this for batch counter reads
  async batchGet(keys: readonly string[]): Promise<Record<string, string | null>>
}
```

**Read the actual interface** in `edictum-ts/packages/core/src/storage.ts:16-20` before implementing. Do NOT guess.

Uses the two tables P1 already created:
- `edictum_session_values` — for `get/set/delete` (TEXT key → TEXT value)
- `edictum_session_counters` — for `increment` (TEXT key → INTEGER value)

**P1 schema migration note:** P1 created these tables with `(session_id, key)` composite primary keys. The actual backend is NOT session-aware (Session prefixes keys itself). Either:
- Migrate to single-column `key TEXT PRIMARY KEY` (cleaner), or
- Keep the composite PK and always pass an empty string for session_id (works but misleading)

Recommended: migrate to single-column PK.

`increment` must be atomic: `INSERT INTO edictum_session_counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + ?`. Return the new value.

Tests:
- `get` returns null for missing key
- `set` then `get` round-trips
- `delete` removes the key
- `increment` from zero returns the amount
- `increment` twice returns cumulative value
- `increment` is atomic (single-statement, no read-modify-write race)
- `batchGet` returns multiple keys in one call

### 4. Implement enforcement module

File: `packages/core/src/enforce.ts`

Two distinct enforcement paths per C1/D19:

```typescript
import { WorkflowRuntime, loadWorkflow, Session, createEnvelope } from '@edictum/core'

class EnforcementManager {
  // Shared immutable definition, loaded once from YAML
  private definition: WorkflowDefinition
  // Per-run runtimes (D27 — each has its own lock, no cross-run serialization)
  private runtimes: Map<RunId, WorkflowRuntime> = new Map()

  constructor(workflowPath: string, private storageBackend: SqliteStorageBackend)

  // Load workflow YAML (call once at startup)
  async initialize(): Promise<void>

  // Get or create WorkflowRuntime for a run (D27)
  getRuntime(runId: RunId): WorkflowRuntime

  // Clean up when run completes (free memory)
  disposeRuntime(runId: RunId): void

  // PATH 1: Inner-loop tool authorization (harness-internal)
  // Called by harness on every intercepted tool call
  // NOT in the MCP surface
  async authorizeTool(
    runId: RunId,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<{ allowed: boolean; reason?: string }>

  // PATH 2: Outer-loop stage transition (agent-visible MCP tool)
  // Called by agent to request advancing to next stage
  async gateCheck(
    runId: RunId,
    targetStage: RunStage,
    evidence: Evidence[]
  ): Promise<{ allowed: boolean; reason?: string }>

  // Get current workflow state for a run
  async getWorkflowState(runId: RunId): Promise<WorkflowState>

  // Sync Ductum run stage with @edictum/core workflow stage
  async syncWorkflowStage(runId: RunId, stage: RunStage): Promise<void>
}
```

**Integration model (D28): Ductum owns the state machine. @edictum/core is a linear guardrail projection synced via setStage() (forward) and reset() (backward). Never call recordResult() — Ductum does not use auto-advance.**

`authorizeTool` implementation:
1. Create @edictum/core Session keyed by `runId` — NOT harness sessionId (D24: run.id is stable across crash/resume). Session forbids `:` in sessionId — nanoid is safe.
2. Get per-run WorkflowRuntime via `getRuntime(runId)` (D27)
3. Create tool envelope via `createEnvelope(toolName, toolArgs, { runId })`
4. Call `runtime.evaluate(session, envelope)` — checks tool is allowed in current workflow stage
5. **Do NOT call `runtime.recordResult()`** — that triggers auto-advance
6. Record gate evaluation in `gate_evaluations` table
7. Return allowed/blocked with reason

`gateCheck` implementation:
1. Validate the from -> to transition is valid (via VALID_TRANSITIONS)
2. Check evidence requirements for the specific transition:
   - implementing -> pre-push-review: requires test evidence
   - (both latches) -> merging: requires CI pass + review pass evidence
3. If all conditions met, transition the run via state machine
4. Sync @edictum/core workflow stage:
   - **Forward move** (implementing → pre-push-review, pushing → merging): call `runtime.setStage(session, targetStage)` — preserves evidence/approvals
   - **Backward move** (any → fixing): call `runtime.reset(session, 'fixing')` — clears stale evidence for rolled-back stages (correct behavior)
5. Record gate evaluation
6. Return allowed/blocked with reason

`syncWorkflowStage` implementation:
1. Determine direction: is targetStage after or before the current workflow activeStage?
2. Forward: `runtime.setStage(session, targetStage)`
3. Backward: `runtime.reset(session, targetStage)`

### 5. Create coding-guard.yaml workflow

File: `workflows/coding-guard.yaml`

The default Edictum workflow definition per spec.md §7.2:

```yaml
apiVersion: edictum/v1
kind: Workflow
metadata:
  name: coding-guard
  description: Default coding workflow for Ductum runs — linear guardrail projection
stages:
  - id: accepted
    description: Agent has claimed the task, reading context
    tools: [Read, Glob, Grep]
    entry: []
    exit: []
    checks: []

  - id: implementing
    description: Building from task prompt
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    entry:
      - condition: "stage_complete(accepted)"
        message: "Stage advancement managed by Ductum — do not auto-advance"
    exit: []
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during implementing"

  - id: fixing
    description: Remediating CI/review findings
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    entry:
      - condition: "stage_complete(implementing)"
        message: "Stage advancement managed by Ductum"
    exit: []
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during fixing"

  - id: pre-push-review
    description: Local review of diff before push
    tools: [Read, Glob, Grep, Bash]
    entry:
      - condition: "stage_complete(fixing)"
        message: "Stage advancement managed by Ductum"
    exit: []
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during review"

  - id: pushing
    description: Pushing to remote and creating PR
    tools: [Bash]
    entry:
      - condition: "stage_complete(pre-push-review)"
        message: "Stage advancement managed by Ductum"
    exit: []
    checks:
      - command_matches: "^git (push|remote)|^gh pr"
        message: "Only git/gh commands allowed during push stage"

  - id: merging
    description: Merge in progress
    tools: [Bash]
    entry:
      - condition: "stage_complete(pushing)"
        message: "Stage advancement managed by Ductum"
    exit: []
    checks:
      - command_matches: "^gh pr merge"
        message: "Only gh pr merge allowed during merge stage"
```

**Why entry gates?** @edictum/core's WorkflowRuntime auto-advances linearly through stages when entry/exit gates are empty (vacuously true). Since Ductum owns stage advancement via `setStage()`/`reset()`, the `stage_complete()` entry gates block auto-advance. Ductum never calls `recordResult()`, so no stage completion evidence exists, and these gates always evaluate to false — preventing unwanted advancement during `evaluate()`. `setStage()` and `reset()` bypass entry gates (they force-set activeStage).

### 6. SSE event emitter

File: `packages/core/src/events.ts`

Simple typed event emitter for internal use. The API layer (P4) will bridge this to HTTP SSE.

```typescript
type DuctumEvent =
  | { type: 'run.stage_changed'; runId: RunId; from: RunStage; to: RunStage; reason?: string }
  | { type: 'run.evidence_attached'; runId: RunId; evidenceId: EvidenceId }
  | { type: 'run.heartbeat'; runId: RunId }
  | { type: 'task.status_changed'; taskId: TaskId; from: TaskStatus; to: TaskStatus }
  | { type: 'spec.status_changed'; specId: SpecId; from: SpecStatus; to: SpecStatus }
  | { type: 'approval.requested'; runId: RunId }
  | { type: 'gate.evaluated'; runId: RunId; gateType: string; result: string }

class DuctumEventEmitter {
  subscribe(listener: (event: DuctumEvent) => void): () => void
  emit(event: DuctumEvent): void
}
```

### 7. Tests

File: `packages/core/src/tests/state-machine.test.ts`
- All valid transitions succeed
- Invalid transitions throw (e.g., implementing -> merging)
- Parallel latch entry creates both pending latches
- CI pass + review pass -> evaluates merge gate
- CI fail -> resets to fixing
- Review fail -> resets to fixing
- CI pass + review fail -> resets to fixing (fail wins)
- Stage history is recorded for every transition
- Stalled detection works (mock time)
- Resume from stalled sets correct stage

File: `packages/core/src/tests/enforce.test.ts`
- `authorizeTool`: git push blocked during implementing
- `authorizeTool`: git push allowed during pushing
- `authorizeTool`: Write allowed during implementing
- `authorizeTool`: Write blocked during pushing
- `gateCheck`: implementing -> pre-push-review blocked without test evidence
- `gateCheck`: implementing -> pre-push-review allowed with test evidence
- Gate evaluations recorded in database
- Workflow state syncs correctly after stage transitions

File: `packages/core/src/tests/events.test.ts`
- Subscribe receives emitted events
- Unsubscribe stops receiving
- Multiple subscribers all receive

## Verification Checklist

- [ ] `pnpm test` in packages/core — all state machine tests pass
- [ ] All valid transitions from spec.md §6.2 are covered
- [ ] Invalid transitions throw descriptive errors
- [ ] Parallel latches work correctly (both must resolve)
- [ ] Latch failure triggers reset to fixing (not implementing)
- [ ] Reset is only callable internally (not exported as MCP tool)
- [ ] authorize_tool uses @edictum/core WorkflowRuntime.evaluate()
- [ ] gate_check validates transitions and evidence requirements
- [ ] coding-guard.yaml loads successfully via @edictum/core loadWorkflow()
- [ ] Stage history is append-only (no deletions)
- [ ] SSE events emitted on every transition
- [ ] No file exceeds 300 lines
