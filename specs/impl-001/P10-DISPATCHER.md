# P10: Push-Mode Dispatcher

**Scope:** Automated dispatch loop, agent matching, concurrent run coordination, next-task prep
**Package:** `packages/core`
**Depends on:** P3 (DAG evaluator), P7 (Claude harness), P8 (OpenCode harness), P9 (watchers)
**Deliverable:** Dispatcher that automatically spawns agents for unblocked tasks
**Verification:** `cd packages/core && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §12 (Dispatcher)
- `ARCHITECTURE.md` §Agent work modes (push mode vs pull mode)
- `VISION.md` §Run sub-states: "Next-task prep is not a Run sub-state — it's Ductum Core dispatcher behavior"
- `decisions/001-founding-session.md` §D5 (agents assigned at project level with roles)
- `decisions/010-p3-role-matching-gap.md` §D30 (required_role schema gap — fix in this prompt)

## Shared Modules

| What | Where |
|------|-------|
| DAGEvaluator (nextTask) | `packages/core/src/dag.ts` |
| RunStateMachine | `packages/core/src/state-machine.ts` |
| WatcherManager | `packages/core/src/watcher-manager.ts` |
| HarnessAdapter | `packages/harness/src/types.ts` |
| ClaudeHarnessAdapter | `packages/harness/src/claude.ts` |
| OpenCodeHarnessAdapter | `packages/harness/src/opencode.ts` |
| All repos | `packages/core/src/repos/` |

## Tasks

### 0. Add required_role column to tasks (D30)

P3 noted that unassigned tasks default to `builder` because there's no way to express "this task needs a reviewer" without explicit agent assignment. Fix this before building the dispatcher.

**Migration** — add to `packages/core/src/db.ts`:
```sql
ALTER TABLE tasks ADD COLUMN required_role TEXT
  CHECK (required_role IN (NULL, 'builder', 'reviewer', 'docs', 'watcher'));
```

**Type** — add to `Task` in `packages/core/src/types.ts`:
```typescript
requiredRole: AgentRole | null  // null = builder (default)
```

**Repository** — update `TaskRepo` in `packages/core/src/repos/task.ts`:
- `create()`: accept and persist `requiredRole`
- `getReady()`: filter by `requiredRole` when a role filter is passed (replaces the current JSON capability text match workaround at task.ts:79)

**DAG update** — update `nextTask()` in `packages/core/src/dag.ts`:
- If task has `requiredRole` set: match agents with that project role
- If task has `requiredRole` null: match agents with `builder` role (existing behavior)

**Tests** — add to `packages/core/src/tests/dag.test.ts`:
- Task with `requiredRole: 'reviewer'` → nextTask(role='reviewer') returns it
- Task with `requiredRole: 'reviewer'` → nextTask(role='builder') skips it
- Task with `requiredRole: null` → nextTask(role='builder') returns it (backward compat)

### 1. Implement Dispatcher class

File: `packages/core/src/dispatcher.ts`

```typescript
class Dispatcher {
  private running = false
  private pollInterval: NodeJS.Timeout | null = null
  private activeSessions: Map<RunId, HarnessSession> = new Map()

  constructor(
    private dag: DAGEvaluator,
    private runRepo: RunRepo,
    private taskRepo: TaskRepo,
    private agentRepo: AgentRepo,
    private projectAgentRepo: ProjectAgentRepo,
    private specRepo: SpecRepo,
    private stateMachine: RunStateMachine,
    private watcherManager: WatcherManager,
    private sessionMappingRepo: SessionRunMappingRepo,
    private harnessAdapters: Map<string, HarnessAdapter>,  // 'claude-agent-sdk' | 'opencode'
    private eventEmitter: DuctumEventEmitter,
    private config: DispatcherConfig,
  )

  // Start the dispatch loop
  start(): void

  // Stop the dispatch loop
  stop(): void

  // Single dispatch cycle (also callable manually)
  async cycle(): Promise<DispatchResult>

  // Get dispatcher status
  status(): DispatcherStatus
}

interface DispatcherConfig {
  pollIntervalMs: number    // default: 10_000 (10s)
  maxConcurrentRuns: number // default: 3
  enabled: boolean          // default: true
}

interface DispatchResult {
  tasksEvaluated: number
  tasksDispatched: TaskId[]
  errors: Array<{ taskId: TaskId; error: string }>
}

interface DispatcherStatus {
  running: boolean
  activeRuns: number
  maxConcurrentRuns: number
  lastCycleAt: string | null
}
```

### 2. Dispatch cycle logic

In `cycle()`:

```typescript
async cycle(): Promise<DispatchResult> {
  const result: DispatchResult = { tasksEvaluated: 0, tasksDispatched: [], errors: [] }

  // 1. Check concurrent run limit
  const activeRuns = this.runRepo.getActive()
  if (activeRuns.length >= this.config.maxConcurrentRuns) {
    return result  // at capacity
  }

  const slotsAvailable = this.config.maxConcurrentRuns - activeRuns.length

  // 2. Get ready tasks (DAG already evaluated)
  // Loop through ready tasks up to available slots
  for (let i = 0; i < slotsAvailable; i++) {
    const task = this.dag.nextTask()
    if (!task) break  // no more ready tasks

    result.tasksEvaluated++

    try {
      // 3. Match agent
      const agent = await this.matchAgent(task)
      if (!agent) {
        result.errors.push({ taskId: task.id, error: 'No available agent matches task' })
        continue
      }

      // 4. Dispatch
      await this.dispatch(task, agent)
      result.tasksDispatched.push(task.id)
    } catch (error) {
      result.errors.push({ taskId: task.id, error: String(error) })
    }
  }

  return result
}
```

### 3. Agent matching (updated for D30 — required_role)

```typescript
private async matchAgent(task: Task): Promise<Agent | null> {
  // Priority 1: explicit assignment
  if (task.assignedAgentId) {
    return this.agentRepo.get(task.assignedAgentId)
  }

  // Priority 2: match by task.requiredRole (D30)
  const targetRole = task.requiredRole ?? 'builder'  // null defaults to builder
  const spec = this.specRepo.get(task.specId)!
  const projectAgents = this.projectAgentRepo.getByRole(spec.projectId, targetRole)

  // Find an idle agent with the matching role
  const activeAgentIds = new Set(
    this.runRepo.getActive().map(r => r.agentId)
  )

  for (const pa of projectAgents) {
    if (activeAgentIds.has(pa.agentId)) continue
    const agent = this.agentRepo.get(pa.agentId)
    if (agent) return agent
  }

  return null
}
```

### 4. Task dispatch

```typescript
private async dispatch(task: Task, agent: Agent): Promise<void> {
  // 1. Create run
  const run = this.runRepo.create({
    id: createId(),
    taskId: task.id,
    agentId: agent.id,
    parentRunId: null,
    stage: 'accepted',
    sessionId: null,
    branch: null, commitSha: null, prNumber: null, prUrl: null,
    ciStatus: null, reviewStatus: null,
    failReason: null, recoverable: true,
    tokensIn: 0, tokensOut: 0, costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })

  // 2. Mark task as active
  this.taskRepo.updateStatus(task.id, 'active')

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt(task, run)

  // 4. Get harness adapter
  const adapter = this.harnessAdapters.get(agent.harness)
  if (!adapter) throw new Error(`No harness adapter for: ${agent.harness}`)

  // 5. Create per-session MCP server pre-bound to run_id BEFORE spawning agent (D22)
  //    The agent session needs MCP available from its first message.
  const mcpServer = createMcpServer(this.apiUrl, run.id)

  // 6. Spawn agent session — pass MCP server so harness can wire it to the session
  const session = await adapter.spawn(run, task, systemPrompt, mcpServer)

  // 7. Record session mapping — DISPATCHER IS SOLE OWNER (D25)
  //    Harness adapters do NOT create this. They return sessionId.
  this.sessionMappingRepo.create({
    sessionId: session.sessionId,
    runId: run.id,
    harness: agent.harness,
  })

  // 8. Update run with session ID
  this.runRepo.updateField(run.id, 'sessionId', session.sessionId)

  // 9. Track active session
  this.activeSessions.set(run.id, session)

  // 9. Monitor session completion
  session.waitForCompletion().then((result) => {
    this.activeSessions.delete(run.id)
    this.handleSessionEnd(run.id, result)
  })

  // 10. Emit event
  this.eventEmitter.emit({
    type: 'run.stage_changed',
    runId: run.id,
    from: 'accepted',
    to: 'accepted',
    reason: `Dispatched to ${agent.name}`,
  })
}
```

### 5. Session end handling

```typescript
private async handleSessionEnd(runId: RunId, result: HarnessSessionResult): Promise<void> {
  const run = this.runRepo.get(runId)
  if (!run) return

  if (result.exitReason === 'completed') {
    // Agent finished normally — run state should already be updated
    // via MCP tool calls (ductum.complete)
  } else if (result.exitReason === 'crashed' || result.exitReason === 'timeout') {
    // Session crashed — mark run as stalled
    // (heartbeat timeout will also catch this, but this is faster)
    this.stateMachine.markStalled(runId)
  }

  // Update final token counts
  this.runRepo.updateTokens(runId, result.tokensIn, result.tokensOut, result.costUsd)
}
```

### 6. Stalled run detection loop

```typescript
// Runs alongside the dispatch loop
private checkStalled(): void {
  const stalledRuns = this.stateMachine.checkStalledRuns()
  for (const run of stalledRuns) {
    // Kill the session if it's still running
    const session = this.activeSessions.get(run.id)
    if (session) {
      const adapter = this.harnessAdapters.get(run.agent.harness)
      adapter?.kill(session.sessionId)
      this.activeSessions.delete(run.id)
    }

    // Stop watchers for this run
    this.watcherManager.stopWatchers(run.id)
  }
}
```

### 7. Event-driven watcher spawning

Listen for `run.stage_changed` events where `to` is `waiting-for-ci`:

```typescript
this.eventEmitter.subscribe((event) => {
  if (event.type === 'run.stage_changed' && event.to === 'waiting-for-ci') {
    const run = this.runRepo.get(event.runId)
    if (run && run.prUrl) {
      this.watcherManager.spawnWatchers(run)
    }
  }
})
```

### 8. Tests

File: `packages/core/src/tests/dispatcher.test.ts`

Mock harness adapters:

- **Dispatch cycle:** ready task found -> agent matched -> session spawned
- **Concurrent limit:** 3 active runs -> no new dispatches
- **Agent matching:** explicit assignment takes priority over role matching
- **Agent matching:** busy agents skipped
- **No ready tasks:** cycle returns empty
- **Session crash:** run marked stalled
- **Stalled detection:** kills session and stops watchers
- **Event-driven watchers:** entering parallel latches spawns watchers
- **Full lifecycle mock:** dispatch -> implement -> push -> watchers -> merge -> DAG advance

## Verification Checklist

- [ ] `pnpm test` in packages/core — all dispatcher tests pass
- [ ] Dispatch loop polls at configured interval
- [ ] Ready tasks matched to available agents
- [ ] Concurrent run limit respected
- [ ] Explicit agent assignment takes priority
- [ ] Session-to-run mapping created on dispatch — dispatcher is sole owner (D25)
- [ ] Per-session MCP server pre-bound to run_id (D22)
- [ ] Session crash detected and run marked stalled
- [ ] Stalled run detection kills sessions and stops watchers
- [ ] Watchers spawned when runs enter parallel latch state
- [ ] Dispatcher start/stop works cleanly
- [ ] Dispatch cycle callable manually (for testing/CLI)
- [ ] required_role column added to tasks table (D30)
- [ ] Tasks with requiredRole='reviewer' matched to reviewer agents
- [ ] Tasks with requiredRole=null matched to builder agents (backward compat)
- [ ] Existing P3 DAG tests still pass after migration
