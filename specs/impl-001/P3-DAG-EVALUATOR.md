# P3: DAG Evaluator

**Scope:** Task and spec dependency resolution, re-evaluation on completion, status propagation
**Package:** `packages/core`
**Depends on:** P1 (types, repos)
**Deliverable:** DAGEvaluator class with task/spec DAG evaluation, re-evaluation triggers
**Verification:** `cd packages/core && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §10 (DAG Evaluation)
- `VISION.md` §Task ("Tasks form a DAG within a spec"), §Spec ("Specs can depend on other specs")
- `decisions/001-founding-session.md` §D6 (specs can depend on other specs)
- `ARCHITECTURE.md` §Run state machine, final node: "done -> DAG re-evaluation"

## Shared Modules (import from P1)

| What | Where |
|------|-------|
| TaskRepo, TaskDependencyRepo | `packages/core/src/repos/task.ts` |
| SpecRepo, SpecDependencyRepo | `packages/core/src/repos/spec.ts` |
| RunRepo | `packages/core/src/repos/run.ts` |
| DuctumEventEmitter | `packages/core/src/events.ts` (from P2) |
| All types | `packages/core/src/types.ts` |

## Tasks

### 1. Implement task DAG evaluator

File: `packages/core/src/dag.ts`

```typescript
class DAGEvaluator {
  constructor(
    private taskRepo: TaskRepo,
    private taskDepRepo: TaskDependencyRepo,
    private specRepo: SpecRepo,
    private specDepRepo: SpecDependencyRepo,
    private runRepo: RunRepo,
    private eventEmitter: DuctumEventEmitter,
  )

  // Evaluate all tasks in a spec, updating status based on dependencies
  evaluateTaskDAG(specId: SpecId): TaskId[]

  // Evaluate all specs in a project, checking hard dependencies
  evaluateSpecDAG(projectId: ProjectId): SpecId[]

  // Full re-evaluation triggered when a run completes
  onRunComplete(runId: RunId): void

  // Get the next unblocked task matching optional filters
  nextTask(projectId?: ProjectId, role?: AgentRole): Task | null

  // Validate that a set of task dependencies forms a valid DAG (no cycles)
  validateDAG(specId: SpecId): { valid: boolean; cycle?: TaskId[] }
}
```

### 2. Task DAG evaluation logic

In `evaluateTaskDAG(specId)`:

1. Get all tasks for the spec
2. Get all task dependencies for the spec
3. Build adjacency list: `taskId -> dependsOnIds[]`
4. For each task:
   - If status is `done` or `active` or `failed` -> skip (already resolved)
   - If ALL dependencies have status `done` -> set status to `ready`
   - If ANY dependency has status `failed` -> set status to `failed` (propagate)
   - Else -> set status to `blocked`
5. Emit `task.status_changed` events for any changes
6. Return list of newly-ready task IDs

### 3. Spec DAG evaluation logic

In `evaluateSpecDAG(projectId)`:

1. Get all specs for the project
2. Get all spec dependencies (both hard and soft)
3. For each spec with status `approved`:
   - Check all HARD dependencies (soft dependencies don't block)
   - If ALL hard dependencies have status `done` -> spec can start (return in ready list)
   - Else -> spec remains in `approved` (blocked by dependency)
4. Return list of ready-to-start spec IDs

### 4. Run completion cascade

In `onRunComplete(runId)`:

1. Get the run, get the task
2. Check: are ALL runs for this task `done`? (task may have retry runs)
   - If latest run is `done` -> mark task as `done`
3. Re-evaluate the task DAG for the task's spec
4. Check: are ALL tasks in the spec `done`?
   - If yes -> mark spec as `done`
5. Re-evaluate the spec DAG for the project
6. Emit events for all status changes

### 5. Next task matching

In `nextTask(projectId?, role?)`:

1. Query tasks with status `ready`
2. If projectId filter: join through specs to filter by project
3. If role filter: match against project_agents roles and agent capabilities
4. Order by: spec priority (creation order), then task creation order
5. Return first matching task, or null

### 6. DAG cycle detection

In `validateDAG(specId)`:

1. Build directed graph from task dependencies
2. Run topological sort (Kahn's algorithm)
3. If sort completes with all nodes -> valid DAG
4. If nodes remain -> cycle exists, return the cycle

This is called when adding task dependencies (in the API layer, P4) to prevent invalid DAGs.

### 7. Tests

File: `packages/core/src/tests/dag.test.ts`

**Task DAG tests:**
- Linear chain: A -> B -> C. Complete A -> B becomes ready. Complete B -> C becomes ready.
- Diamond: A -> B, A -> C, B -> D, C -> D. Complete A -> B and C ready. Complete B -> D still blocked. Complete C -> D ready.
- No dependencies: all tasks immediately ready
- Failed task propagates: A -> B. A fails -> B fails (propagation)
- Multiple runs: task with failed run + successful run -> task is done (latest run wins)

**Spec DAG tests:**
- Hard dependency blocks: spec B depends on spec A (hard). A not done -> B blocked.
- Hard dependency unblocks: A done -> B can start.
- Soft dependency doesn't block: spec B soft-depends on A. A not done -> B can still start.
- Mixed: B hard-depends on A, soft-depends on C. A done, C not done -> B can start.

**Run completion cascade tests:**
- Run done -> task done -> spec tasks re-evaluated -> dependent tasks unblocked
- All tasks done -> spec done -> project specs re-evaluated

**Cycle detection tests:**
- Valid DAG passes
- A -> B -> A detected as cycle
- A -> B -> C -> A detected as cycle
- Complex graph with valid topological ordering passes

**Next task tests:**
- Returns highest-priority ready task
- Filters by project
- Filters by role (agent must be assigned to project with matching role)
- Returns null when no tasks are ready

## Verification Checklist

- [ ] `pnpm test` in packages/core — all DAG tests pass
- [ ] Task DAG correctly identifies ready/blocked/failed tasks
- [ ] Spec DAG respects hard vs soft dependencies
- [ ] Run completion cascades through task -> spec -> project
- [ ] Cycle detection catches all cycles
- [ ] nextTask respects project and role filters
- [ ] Status change events emitted for all transitions
- [ ] Failed task propagation works correctly
- [ ] No file exceeds 300 lines
