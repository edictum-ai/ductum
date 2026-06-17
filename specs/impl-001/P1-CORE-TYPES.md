# P1: Core Types + SQLite Persistence

**Scope:** TypeScript types for all primitives, SQLite schema, repository pattern, database setup
**Package:** `packages/core`
**Depends on:** —
**Deliverable:** All types, migrations, CRUD repositories, DB initialization, ID generation
**Verification:** `cd packages/core && pnpm test`

---

## Required Reading

- `specs/impl-001/spec.md` §5 (Data Model — types and schema)
- `CLAUDE.md` §Tech stack (better-sqlite3, nanoid, pnpm)
- `VISION.md` §Primitives (Factory, Project, Agent, Spec, Task, Decision, Run, Watcher)
- `ARCHITECTURE.md` §Run state machine (all valid stages and transitions)
- `decisions/006-round-3-final.md` §D20 (agents don't self-reset), §D21 (session-run mapping)

## Tasks

### 1. Scaffold monorepo

Initialize the pnpm workspace:

- Root `pnpm-workspace.yaml` with `packages/*`
- Root `package.json` with workspace scripts: `test`, `lint`, `build`
- Root `tsconfig.base.json` with strict TypeScript, ESM, Node 22 target
- `packages/core/package.json` with dependencies: `better-sqlite3`, `nanoid`
- `packages/core/tsconfig.json` extending base

Dev dependencies at root: `vitest`, `typescript`, `@types/better-sqlite3`, `eslint`

### 2. Define all TypeScript types

File: `packages/core/src/types.ts`

All types from spec.md §5.1:
- `Factory`, `FactoryConfig`
- `Project`, `ProjectConfig`
- `Agent`, `AgentCapability`, `AgentRole`, `AgentSpawnConfig`
- `ProjectAgent`
- `Spec`, `SpecStatus`, `SpecDependency`
- `Task`, `TaskStatus`, `TaskDependency`
- `Decision`
- `Run`, `RunStage`, `RunStageTransition`
- `Evidence`, `EvidenceType`
- `GateEvaluation`
- `SessionRunMapping`

All ID types as branded strings:
```typescript
type FactoryId = string & { readonly __brand: 'FactoryId' }
type ProjectId = string & { readonly __brand: 'ProjectId' }
// ... etc.
```

Export a `createId()` function using nanoid (length 12, URL-safe).

### 3. Database setup + migrations

File: `packages/core/src/db.ts`

- `initDb(dbPath: string): Database` — creates SQLite database, enables WAL mode, runs migrations
- Migrations embedded as string constants (not separate files — simpler for local-first app)
- Full schema from spec.md §5.2
- Enable foreign keys: `PRAGMA foreign_keys = ON`
- Enable WAL mode: `PRAGMA journal_mode = WAL`

Test: `initDb` creates all tables, idempotent on re-run.

### 4. Repository interfaces

File: `packages/core/src/repos/interfaces.ts`

Define repository interfaces for each primitive:

```typescript
interface FactoryRepo {
  get(): Factory | null
  create(factory: Omit<Factory, 'createdAt'>): Factory
  update(id: FactoryId, config: FactoryConfig): Factory
}

interface ProjectRepo {
  list(factoryId: FactoryId): Project[]
  get(id: ProjectId): Project | null
  getByName(name: string): Project | null
  create(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project
  update(id: ProjectId, fields: Partial<Pick<Project, 'name' | 'repos' | 'config'>>): Project
  delete(id: ProjectId): void
}

interface AgentRepo {
  list(): Agent[]
  get(id: AgentId): Agent | null
  getByName(name: string): Agent | null
  create(agent: Omit<Agent, 'createdAt'>): Agent
  update(id: AgentId, fields: Partial<Pick<Agent, 'model' | 'capabilities' | 'spawnConfig'>>): Agent
  delete(id: AgentId): void
}

interface ProjectAgentRepo {
  list(projectId: ProjectId): ProjectAgent[]
  assign(assignment: ProjectAgent): void
  unassign(projectId: ProjectId, agentId: AgentId): void
  getByRole(projectId: ProjectId, role: AgentRole): ProjectAgent[]
}

interface SpecRepo {
  list(projectId: ProjectId): Spec[]
  get(id: SpecId): Spec | null
  create(spec: Omit<Spec, 'createdAt' | 'updatedAt'>): Spec
  updateStatus(id: SpecId, status: SpecStatus): Spec
  delete(id: SpecId): void
}

interface SpecDependencyRepo {
  list(specId: SpecId): SpecDependency[]
  add(dep: SpecDependency): void
  remove(specId: SpecId, dependsOnId: SpecId): void
}

interface TaskRepo {
  list(specId: SpecId): Task[]
  get(id: TaskId): Task | null
  getReady(projectId?: ProjectId, role?: AgentRole): Task[]
  create(task: Omit<Task, 'createdAt' | 'updatedAt'>): Task
  updateStatus(id: TaskId, status: TaskStatus): Task
  assignAgent(id: TaskId, agentId: AgentId): Task
  delete(id: TaskId): void
}

interface TaskDependencyRepo {
  list(taskId: TaskId): TaskDependency[]
  add(dep: TaskDependency): void
  remove(taskId: TaskId, dependsOnId: TaskId): void
}

interface DecisionRepo {
  list(filters: { specId?: SpecId; taskId?: TaskId; runId?: RunId }): Decision[]
  create(decision: Omit<Decision, 'createdAt'>): Decision
}

interface RunRepo {
  list(taskId: TaskId): Run[]
  get(id: RunId): Run | null
  getBySessionId(sessionId: string): Run | null
  getActive(): Run[]
  getStalled(cutoffTime: string): Run[]
  create(run: Omit<Run, 'createdAt' | 'updatedAt'>): Run
  updateStage(id: RunId, stage: RunStage, reason?: string): Run
  updateGitArtifacts(id: RunId, fields: Partial<Pick<Run, 'branch' | 'commitSha' | 'prNumber' | 'prUrl'>>): Run
  updateLatchStatus(id: RunId, field: 'ciStatus' | 'reviewStatus', status: 'pending' | 'pass' | 'fail'): Run
  updateHeartbeat(id: RunId): Run
  updateTokens(id: RunId, tokensIn: number, tokensOut: number, costUsd: number): Run
  updateFailure(id: RunId, reason: string, recoverable: boolean): Run
}

interface RunStageHistoryRepo {
  list(runId: RunId): RunStageTransition[]
  add(transition: Omit<RunStageTransition, 'id' | 'createdAt'>): RunStageTransition
}

interface EvidenceRepo {
  list(runId: RunId): Evidence[]
  create(evidence: Omit<Evidence, 'createdAt'>): Evidence
}

interface GateEvaluationRepo {
  list(runId: RunId): GateEvaluation[]
  create(evaluation: Omit<GateEvaluation, 'id' | 'createdAt'>): GateEvaluation
}

interface SessionRunMappingRepo {
  get(sessionId: string): SessionRunMapping | null
  getByRunId(runId: RunId): SessionRunMapping | null
  create(mapping: Omit<SessionRunMapping, 'createdAt'>): SessionRunMapping
  delete(sessionId: string): void
}
```

### 5. SQLite repository implementations

One file per repo in `packages/core/src/repos/`:

- `factory.ts` — FactoryRepo (SQLite)
- `project.ts` — ProjectRepo + ProjectAgentRepo (SQLite)
- `agent.ts` — AgentRepo (SQLite)
- `spec.ts` — SpecRepo + SpecDependencyRepo (SQLite)
- `task.ts` — TaskRepo + TaskDependencyRepo (SQLite)
- `decision.ts` — DecisionRepo (SQLite)
- `run.ts` — RunRepo + RunStageHistoryRepo (SQLite)
- `evidence.ts` — EvidenceRepo + GateEvaluationRepo (SQLite)
- `session.ts` — SessionRunMappingRepo (SQLite)

JSON columns (`repos`, `capabilities`, `config`, `spawn_config`, `verification`, `alternatives`, `payload`) use `JSON.parse`/`JSON.stringify` in the repository layer. The database stores them as TEXT.

Each repo takes a `Database` instance via constructor. No singletons.

### 6. Export barrel

File: `packages/core/src/index.ts`

Export all types, `initDb`, `createId`, and all repository interfaces + implementations.

### 7. Tests

File: `packages/core/src/tests/db.test.ts`
- `initDb` creates all tables
- `initDb` is idempotent
- WAL mode is enabled
- Foreign keys are enforced

File: `packages/core/src/tests/repos.test.ts`
- CRUD operations for each repo
- JSON column round-trip (create with array/object, read back correctly)
- Foreign key constraints (delete project cascades specs, tasks)
- `getReady` returns only tasks with all dependencies done
- `getStalled` returns runs past heartbeat timeout
- `getBySessionId` resolves session-to-run mapping

Use in-memory SQLite (`:memory:`) for tests.

## Verification Checklist

- [ ] `pnpm test` in packages/core — all pass
- [ ] All types from spec.md §5.1 are defined and exported
- [ ] SQLite schema matches spec.md §5.2 exactly
- [ ] WAL mode enabled, foreign keys enforced
- [ ] All repository CRUD operations tested
- [ ] JSON columns round-trip correctly
- [ ] `createId()` produces URL-safe 12-char IDs
- [ ] Cascade deletes work (project -> specs -> tasks)
- [ ] `getStalled()` correctly identifies runs past heartbeat timeout
- [ ] No file exceeds 300 lines
