import type {
  Agent,
  AgentId,
  AgentRole,
  Decision,
  Factory,
  FactoryConfig,
  FactoryId,
  Evidence,
  GateEvaluation,
  Project,
  ProjectAgent,
  ProjectId,
  Run,
  RunId,
  RunLatchStatus,
  RunStageTransition,
  RunUpdate,
  SessionRunMapping,
  Spec,
  SpecDependency,
  SpecId,
  SpecStatus,
  SpecStrategy,
  Task,
  TaskDependency,
  TaskId,
  TaskStatus,
  TaskStrategyRole,
  TerminalState,
  WorkflowStage,
} from '../types.js'
import type {
  Component,
  ComponentSpec,
  ConfigResource,
  ConfigResourceKind,
  ConfigResourceSpec,
  Repository,
  RepositoryId,
  RepositorySpec,
  Target,
  TargetSpec,
} from '../resource-types.js'
import type { RunCheckpoint, RunCheckpointInput } from '../run-checkpoint.js'
import type { FencingToken } from '../attempt-lease.js'

export type { AttemptLeaseRepo } from './attempt-lease-interface.js'

export interface FactoryRepo {
  get(): Factory | null
  create(factory: Omit<Factory, 'createdAt'>): Factory
  update(id: FactoryId, fields: Partial<Pick<Factory, 'name' | 'config'>>): Factory
}

export interface ProjectRepo {
  list(factoryId: FactoryId): Project[]
  get(id: ProjectId): Project | null
  getByName(name: string): Project | null
  create(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project
  update(id: ProjectId, fields: Partial<Pick<Project, 'name' | 'repos' | 'config'>>): Project
  delete(id: ProjectId): void
}

export interface TargetRepo {
  list(projectId: ProjectId): Target[]
  get(id: Target['id']): Target | null
  getByName(projectId: ProjectId, name: string): Target | null
  create(target: Omit<Target, 'createdAt' | 'updatedAt'>): Target
  update(id: Target['id'], fields: Partial<Pick<Target, 'name' | 'spec'>>): Target
  upsert(projectId: ProjectId, name: string, spec: TargetSpec): Target
  delete(id: Target['id']): void
}

export interface RepositoryRepo {
  list(projectId: ProjectId): Repository[]
  get(id: RepositoryId): Repository | null
  getByName(projectId: ProjectId, name: string): Repository | null
  create(repository: Omit<Repository, 'identity' | 'portable' | 'readiness' | 'createdAt' | 'updatedAt'>): Repository
  update(id: RepositoryId, fields: Partial<Pick<Repository, 'name' | 'spec'>>): Repository
  upsert(projectId: ProjectId, name: string, spec: RepositorySpec): Repository
  delete(id: RepositoryId): void
}

export interface ComponentRepo {
  list(repositoryId: RepositoryId): Component[]
  get(id: Component['id']): Component | null
  getByName(repositoryId: RepositoryId, name: string): Component | null
  create(component: Omit<Component, 'createdAt' | 'updatedAt'>): Component
  update(id: Component['id'], fields: Partial<Pick<Component, 'name' | 'spec'>>): Component
  upsert(repositoryId: RepositoryId, name: string, spec: ComponentSpec): Component
  delete(id: Component['id']): void
}

export interface ConfigResourceRepo {
  list(filters?: { kind?: ConfigResourceKind; projectId?: ProjectId | null }): ConfigResource[]
  get(id: ConfigResource['id']): ConfigResource | null
  getByName(kind: ConfigResourceKind, name: string, projectId?: ProjectId | null): ConfigResource | null
  create(resource: Omit<ConfigResource, 'createdAt' | 'updatedAt'>): ConfigResource
  update(
    id: ConfigResource['id'],
    fields: Partial<Pick<ConfigResource, 'name' | 'projectId' | 'spec'>>,
  ): ConfigResource
  upsert(kind: ConfigResourceKind, name: string, spec: ConfigResourceSpec, projectId?: ProjectId | null): ConfigResource
  delete(id: ConfigResource['id']): void
}

export interface AgentRepo {
  list(): Agent[]
  get(id: AgentId): Agent | null
  getByName(name: string): Agent | null
  create(agent: Omit<Agent, 'createdAt'>): Agent
  update(id: AgentId, fields: Partial<Pick<Agent, 'model' | 'harness' | 'providerId' | 'accountId' | 'resourceRefs' | 'capabilities' | 'effort' | 'costTier' | 'spawnConfig' | 'pricing'>>): Agent
  delete(id: AgentId): void
}

export interface ProjectAgentRepo {
  list(projectId: ProjectId): ProjectAgent[]
  assign(assignment: ProjectAgent): void
  unassign(projectId: ProjectId, agentId: AgentId, role?: AgentRole): void
  getByRole(projectId: ProjectId, role: AgentRole): ProjectAgent[]
}

export interface SpecRepo {
  list(projectId: ProjectId): Spec[]
  get(id: SpecId): Spec | null
  create(
    spec: Omit<Spec, 'createdAt' | 'updatedAt' | 'maxFixIterations' | 'strategy' | 'strategyConfig'> & {
      maxFixIterations?: number | null
      strategy?: SpecStrategy
      strategyConfig?: Spec['strategyConfig']
    },
  ): Spec
  updateStatus(id: SpecId, status: SpecStatus): Spec
  delete(id: SpecId): void
}

export interface SpecDependencyRepo {
  list(specId: SpecId): SpecDependency[]
  add(dep: SpecDependency): void
  remove(specId: SpecId, dependsOnId: SpecId): void
}

export interface TaskRepo {
  list(specId: SpecId): Task[]
  get(id: TaskId): Task | null
  getReady(projectId?: ProjectId, role?: AgentRole): Task[]
  create(
    task: Omit<
      Task,
      | 'createdAt'
      | 'updatedAt'
      | 'targetId'
      | 'repositoryId'
      | 'componentId'
      | 'requiredRole'
      | 'complexity'
      | 'strategyRole'
      | 'strategyGroup'
      | 'retryCount'
      | 'retryAfter'
      | 'budgetExtraUsd'
      | 'turnExtraCount'
    > & {
      targetId?: Task['targetId']
      repositoryId?: Task['repositoryId']
      componentId?: Task['componentId']
      requiredRole?: Task['requiredRole']
      complexity?: Task['complexity']
      strategyRole?: TaskStrategyRole
      strategyGroup?: string | null
      retryCount?: number
      retryAfter?: string | null
      budgetExtraUsd?: number
      turnExtraCount?: number
    },
  ): Task
  updatePrompt(id: TaskId, prompt: string): Task
  updateStatus(id: TaskId, status: TaskStatus): Task
  updateRetry(id: TaskId, retryCount: number, retryAfter: string | null): Task
  assignAgent(id: TaskId, agentId: AgentId): Task
  /** Add to budgetExtraUsd. Returns the updated task. */
  incrementBudgetExtra(id: TaskId, byUsd: number): Task
  /** Add to turnExtraCount. Returns the updated task (D118). */
  incrementTurnExtra(id: TaskId, byCount: number): Task
  delete(id: TaskId): void
}

export interface TaskDependencyRepo {
  list(taskId: TaskId): TaskDependency[]
  add(dep: TaskDependency): void
  remove(taskId: TaskId, dependsOnId: TaskId): void
}

export interface DecisionRepo {
  list(filters: { specId?: SpecId; taskId?: TaskId; runId?: RunId }): Decision[]
  create(decision: Omit<Decision, 'createdAt'>): Decision
}

export interface RunRepo {
  list(taskId: TaskId): Run[]
  listAll(filters?: { stage?: string; limit?: number }): Run[]
  get(id: RunId): Run | null
  getBySessionId(sessionId: string): Run | null
  getActive(): Run[]
  /** Runs whose failReason indicates a cost budget pause or denial (Decision 114). */
  listFailedWithBudgetReason(): Run[]
  getStalled(cutoffTime: string): Run[]
  create(
    run: Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'attemptSnapshot' | 'verifyRetries'>
      & Partial<Pick<Run, 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'attemptSnapshot' | 'verifyRetries'>>,
  ): Run
  updateSession(id: RunId, sessionId: string | null): Run
  updateStage(id: RunId, stage: WorkflowStage, reason?: string): Run
  updateTerminalState(id: RunId, terminalState: TerminalState | null): Run
  updateTerminalStateFenced?(id: RunId, terminalState: TerminalState | null, fenceToken: FencingToken, now?: Date): Run
  updateAttemptSnapshot(id: RunId, snapshot: NonNullable<Run['attemptSnapshot']>): Run
  updateWorkflowState(
    id: RunId,
    fields: {
      completedStages?: string[]
      blockedReason?: string | null
      pendingApproval?: boolean
    },
  ): Run
  incrementResetCount(id: RunId): Run
  updateWorktreePaths(id: RunId, worktreePaths: string[] | null): Run
  updateGitArtifacts(
    id: RunId,
    fields: Partial<Pick<Run, 'branch' | 'commitSha' | 'prNumber' | 'prUrl'>>,
  ): Run
  updateLatchStatus(id: RunId, field: 'ciStatus' | 'reviewStatus', status: RunLatchStatus): Run
  updateHeartbeat(id: RunId): Run
  incrementVerifyRetries(id: RunId): Run
  updateTokens(id: RunId, tokensIn: number, tokensOut: number, costUsd: number): Run
  updateTokensFenced?(id: RunId, tokensIn: number, tokensOut: number, costUsd: number, fenceToken: FencingToken, now?: Date): Run
  /** Replace (not increment) the token + cost columns. Used by the
   *  cost scanner when it returns an absolute snapshot from the
   *  underlying provider's session log. */
  setTokens(id: RunId, tokensIn: number, tokensOut: number, costUsd: number): Run
  setTokensFenced?(id: RunId, tokensIn: number, tokensOut: number, costUsd: number, fenceToken: FencingToken, now?: Date): Run
  updateFailure(id: RunId, reason: string | null, recoverable: boolean): Run
  updateCompletionSummary(id: RunId, summary: string | null): Run
}

export interface RunStageHistoryRepo {
  list(runId: RunId): RunStageTransition[]
  add(transition: Omit<RunStageTransition, 'id' | 'createdAt'>): RunStageTransition
}

export interface EvidenceRepo {
  list(runId: RunId): Evidence[]
  create(evidence: Omit<Evidence, 'createdAt'>): Evidence
  createFenced?(evidence: Omit<Evidence, 'createdAt'>, fenceToken: FencingToken, now?: Date): Evidence
}

export interface GateEvaluationRepo {
  list(runId: RunId): GateEvaluation[]
  create(evaluation: Omit<GateEvaluation, 'id' | 'createdAt'>): GateEvaluation
}

export interface SessionRunMappingRepo {
  get(sessionId: string): SessionRunMapping | null
  getByRunId(runId: RunId): SessionRunMapping | null
  create(
    mapping: Omit<SessionRunMapping, 'createdAt' | 'controlToken'> & {
      controlToken?: string | null
    },
  ): SessionRunMapping
  updateHarnessSessionId(sessionId: string, harnessSessionId: string): SessionRunMapping
  updateSessionId(sessionId: string, nextSessionId: string, harnessSessionId?: string | null): SessionRunMapping
  delete(sessionId: string): void
}

export interface RunUpdateRepo {
  list(runId: RunId): RunUpdate[]
  create(runId: RunId, message: string): RunUpdate
}

export interface RunCheckpointRepo {
  get(runId: RunId): RunCheckpoint | null
  /** Insert or update the single checkpoint row for a run. */
  upsert(checkpoint: RunCheckpointInput): RunCheckpoint
  upsertFenced?(checkpoint: RunCheckpointInput, fenceToken: FencingToken, now?: Date): RunCheckpoint
  /** All checkpoints for a task's runs, newest run first. */
  list(taskId: TaskId): RunCheckpoint[]
  /**
   * The checkpoint of the task's most-recent stalled run, or null. The
   * resumable-stage / worktree policy is applied by the caller via
   * isResumableCheckpoint — this is a pure data query.
   */
  getLatestStalledCheckpoint(taskId: TaskId): RunCheckpoint | null
  /** Checkpoints of all stalled runs (any task), newest run first. Used by
   *  worktree GC to protect resumable worktrees awaiting resume. */
  listStalledCheckpoints(): RunCheckpoint[]
  /** Checkpoints of all paused/frozen runs (any task), newest run first. Used
   *  by worktree GC to protect operator-resumable worktrees. */
  listHaltedResumableCheckpoints(): RunCheckpoint[]
  delete(runId: RunId): void
}
