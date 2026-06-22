import type {
  Agent,
  AgentRole,
  Decision,
  DispatchResult,
  DispatcherStatus,
  Evidence,
  Factory,
  GateEvaluation,
  Project,
  ProjectAgent,
  Repository,
  Component,
  Run,
  RunActivity,
  RunStageTransition,
  RunUpdate,
  Spec,
  Task,
  TaskDependency,
  Target,
  ConfigResource,
  ConfigResourceKind,
  AgentHealthState,
  FactorySettingsCatalogs,
  FactoryDoctorReport,
  RepairReport,
} from '@ductum/core'
import type { ReconcileResult } from './reconcile-types.js'
import type { ExecutionIntegrityReport } from './execution-integrity-types.js'
import type { BakeoffCompareResponse } from './bakeoff-types.js'

export type {
  ExecutionIntegrityFields,
  ExecutionIntegrityReport,
} from './execution-integrity-types.js'
export type { ReconcileResult } from './reconcile-types.js'
export type { BakeoffCandidateCompare, BakeoffCompareResponse } from './bakeoff-types.js'

export interface AcceptedTaskRun {
  run: Run
  task: Task
}

export interface TaskCompleteResult {
  task: Task
  alreadyDone: boolean
  decision: Decision | null
  evidence: Evidence | null
}

export interface GateCheckResult {
  allowed: boolean
  reason?: string
  run?: Run
}

export interface RunCancelResult {
  run: Run
  cost: {
    tokensIn: number
    tokensOut: number
    usd: number
  }
  worktreePreserved: boolean
  cleanupAt: string | null
  evidenceId: Evidence['id']
}

export interface RedirectRunResult {
  ok: boolean
  runId: Run['id']
  taskId: Task['id']
  taskStatus: Task['status']
  fromAgentId: Agent['id']
  toAgentId: Agent['id']
  toAgentName: string
  failReason: string | null
}

export interface SchemaEnvelope<K extends string = string, D = unknown> {
  schemaVersion: 1
  kind: K
  data: D
  ts: string
}

export interface RecordedImportCommitRef {
  sha: string
  author: string
  subject: string
  branch?: string | null
  taskName?: string
  path?: string
}

export interface RecordImportedTaskRunInput {
  author: string
  branch?: string | null
  commitSha: string
  sourcePath: string
  taskFilePath?: string | null
  subject?: string | null
  importedAt?: string | null
  linkedCommits?: RecordedImportCommitRef[]
}

export interface RecordImportedTaskRunResult {
  task: Task
  run: Run
  agent: Agent
  evidence: Evidence
  alreadyRecorded: boolean
}

export interface HarnessOption {
  id: string
  label: string
}

export interface ModelCatalogEntry {
  id: string
  label: string
  provider: 'openai' | 'anthropic' | 'zai'
  availability: 'api' | 'codex' | 'subscription' | 'coding-plan' | 'beta' | 'legacy'
  supportedHarnesses: string[]
  defaultCostTier: number
  aliases: string[]
  sourceUrl: string
  note: string
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number }
  supportedEfforts?: Agent['effort'][]
}

export interface ModelCatalog {
  models: ModelCatalogEntry[]
  harnesses: HarnessOption[]
}

export interface AgentHealthResetResult {
  ok: true
  reset: boolean
  agent: { id: Agent['id']; name: string }
}

export interface HealthStatus {
  ok: boolean
  /**
   * True when the API rejects unauthenticated requests on `/api/*`
   * (excluding the public health and webhook paths). Returned by
   * `/api/health` so the CLI can detect operator-token protection
   * without needing a token to make the call.
   */
  operatorTokenProtected: boolean
}

export interface RunContext {
  task: Task
  run: Run | null
  history: RunStageTransition[]
  evidence: Evidence[]
  gateEvaluations: GateEvaluation[]
  progressUpdates: RunUpdate[]
  git: {
    branch: string | null
    commitSha: string | null
    prNumber: number | null
    prUrl: string | null
  } | null
}

export interface ApiErrorPayload {
  error: string
  details?: unknown
}

export interface CreateProjectInput {
  name: string
  repos?: string[]
  repository?: CreateRepositoryInput
  repositories?: CreateRepositoryInput[]
  config?: Partial<Project['config']>
}

export interface UpdateProjectInput { name?: string; repos?: string[]; config?: Partial<Project['config']> }

export interface CreateAgentInput {
  name: string
  model?: string
  harness?: Agent['harness']
  resourceRefs?: Agent['resourceRefs']
  capabilities?: Agent['capabilities']
  effort?: Agent['effort']
  costTier?: number
  spawnConfig?: Agent['spawnConfig']
  pricing?: Agent['pricing']
}

export interface UpdateAgentInput {
  model?: string
  harness?: Agent['harness']
  resourceRefs?: Agent['resourceRefs']
  capabilities?: Agent['capabilities']
  effort?: Agent['effort']
  costTier?: number
  spawnConfig?: Agent['spawnConfig']
  pricing?: Agent['pricing']
}

export interface CreateSpecInput {
  name: string
  status?: Spec['status']
  document?: string
  /** Per-spec override for the fix-loop iteration cap. */
  maxFixIterations?: number
}

export interface ImportSpecInput {
  spec: {
    name: string
    status?: Spec['status']
    document?: string
  }
  tasks: Array<{
    name: string
    prompt: string
    repos?: string[]
    verification?: string[]
    requiredRole?: AgentRole
    depends_on?: string[]
  }>
}

export interface ImportSpecResult {
  spec: Spec
  taskCount: number
}

export type BakeoffPolicy = 'quality-gated-cost-aware' | 'cheapest-verified-reviewed'

export interface CreateBakeoffInput {
  name: string
  prompt: string
  builderAgentIds: string[]
  reviewerAgentId?: string
  repositoryId?: string
  componentId?: string
  verify?: string[]
  policy?: BakeoffPolicy
}

export interface CreateBakeoffResult {
  spec: Spec
  candidates: Task[]
  reviewTask: Task
  dependencies: TaskDependency[]
  policy: string
  strategyGroup: string
  reviewer: Agent
  builders: Agent[]
  nextCommands: { watch: string; compare: string }
}

export interface CreateTaskInput {
  name: string
  targetId?: Task['targetId']
  repositoryId?: Task['repositoryId']
  componentId?: Task['componentId']
  prompt?: string
  repos?: string[]
  assignedAgentId?: Task['assignedAgentId']
  requiredRole?: Task['requiredRole']
  complexity?: Task['complexity']
  status?: Task['status']
  verification?: string[]
}

export interface CreateDecisionInput {
  specId?: string; taskId?: string; runId?: string
  decision: string
  context: string
  alternatives?: string[]
  decidedBy: string
  supersedesId?: string
}

export interface CreateTargetInput {
  name: string
  spec: Target['spec']
}

export interface CreateRepositoryInput {
  name?: string
  remoteUrl?: string
  localPath?: string
  defaultBranch?: string
  branchPrefix?: string
  authRef?: string
  components?: CreateComponentInput[]
}

export interface UpdateRepositoryInput {
  name?: string
  spec?: Repository['spec']
}

export interface CreateComponentInput {
  name?: string
  path?: string
}

export interface UpdateComponentInput {
  name?: string
  spec?: Component['spec']
}

export interface UpdateTargetInput {
  name?: string
  spec?: Target['spec']
}

export interface CreateConfigResourceInput {
  name: string
  projectId?: string | null
  spec: ConfigResource['spec']
}

export interface UpdateConfigResourceInput {
  name?: string
  projectId?: string | null
  spec?: ConfigResource['spec']
}

export interface DuctumApi {
  getFactory(): Promise<Factory | null>
  initFactory(input?: Partial<Pick<Factory, 'name'>> & { config?: Partial<Factory['config']> }): Promise<Factory>
  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project>
  deleteProject(id: string): Promise<void>
  listTargets(projectId: string): Promise<Target[]>
  getTarget(id: string): Promise<Target>
  createTarget(projectId: string, input: CreateTargetInput): Promise<Target>
  updateTarget(id: string, input: UpdateTargetInput): Promise<Target>
  deleteTarget(id: string): Promise<void>
  listRepositories(projectId: string): Promise<Repository[]>
  getRepository(id: string): Promise<Repository>
  createRepository(projectId: string, input: CreateRepositoryInput): Promise<Repository>
  updateRepository(id: string, input: UpdateRepositoryInput): Promise<Repository>
  deleteRepository(id: string): Promise<void>
  listComponents(repositoryId: string): Promise<Component[]>
  createComponent(repositoryId: string, input: CreateComponentInput): Promise<Component>
  updateComponent(id: string, input: UpdateComponentInput): Promise<Component>
  deleteComponent(id: string): Promise<void>
  listConfigResources(kind: ConfigResourceKind, projectId?: string | null): Promise<ConfigResource[]>
  getConfigResource(kind: ConfigResourceKind, id: string): Promise<ConfigResource>
  createConfigResource(kind: ConfigResourceKind, input: CreateConfigResourceInput): Promise<ConfigResource>
  updateConfigResource(kind: ConfigResourceKind, id: string, input: UpdateConfigResourceInput): Promise<ConfigResource>
  deleteConfigResource(kind: ConfigResourceKind, id: string): Promise<void>
  listProjectAgents(projectId: string): Promise<ProjectAgent[]>
  assignProjectAgent(projectId: string, agentId: string, role: string): Promise<ProjectAgent>
  getHealth(): Promise<HealthStatus>
  listModels(): Promise<ModelCatalog>
  getFactorySettings(): Promise<FactorySettingsCatalogs>
  getFactoryDoctor(): Promise<FactoryDoctorReport>
  getRepairReport(): Promise<RepairReport>
  listAgents(): Promise<Agent[]>
  getAgentHealth(): Promise<AgentHealthState[]>
  resetAgentHealth(nameOrId: string): Promise<AgentHealthResetResult>
  getAgent(id: string): Promise<Agent>
  createAgent(input: CreateAgentInput): Promise<Agent>
  updateAgent(id: string, input: UpdateAgentInput): Promise<Agent>
  deleteAgent(id: string): Promise<void>
  listSpecs(projectId: string): Promise<Spec[]>
  getSpec(id: string): Promise<Spec>
  createSpec(projectId: string, input: CreateSpecInput): Promise<Spec>
  importSpec(projectId: string, input: ImportSpecInput): Promise<ImportSpecResult>
  createBakeoff(projectId: string, input: CreateBakeoffInput): Promise<CreateBakeoffResult>
  getBakeoffCompare(specId: string): Promise<BakeoffCompareResponse>
  approveSpec(specId: string): Promise<Spec>
  setSpecStatus(specId: string, status: string): Promise<Spec>
  completeTask(taskId: string, reason: string): Promise<TaskCompleteResult>
  listTasks(specId: string): Promise<Task[]>
  getTask(taskId: string): Promise<Task>
  createTask(specId: string, input: CreateTaskInput): Promise<Task>
  updateTaskPrompt(taskId: string, prompt: string): Promise<Task>
  setTaskStatus(taskId: string, status: Task['status']): Promise<Task>
  deleteTask(taskId: string): Promise<void>
  assignTaskAgent(taskId: string, agentId: string): Promise<Task>
  recordImportedTaskRun(taskId: string, input: RecordImportedTaskRunInput): Promise<RecordImportedTaskRunResult>
  listTaskDependencies(taskId: string): Promise<TaskDependency[]>
  addTaskDependency(taskId: string, dependsOnId: string): Promise<TaskDependency>
  listTaskRuns(taskId: string): Promise<Run[]>
  getRun(runId: string): Promise<Run>
  getRunHistory(runId: string): Promise<RunStageTransition[]>
  getRunEvidence(runId: string): Promise<Evidence[]>
  getRunGateEvaluations(runId: string): Promise<GateEvaluation[]>
  getRunUpdates(runId: string): Promise<RunUpdate[]>
  getRunActivity(runId: string, limit?: number): Promise<RunActivity[]>
  listDecisions(filters?: { specId?: string; taskId?: string; runId?: string }): Promise<Decision[]>
  createDecision(input: CreateDecisionInput): Promise<Decision>
  nextTask(project?: string, role?: string): Promise<Task | null>
  accept(taskId: string): Promise<AcceptedTaskRun>
  dispatch(taskId: string, agentId: string): Promise<Run>
  complete(runId: string, result: string, pr?: string): Promise<Run>
  update(runId: string, message: string): Promise<RunUpdate>
  heartbeat(runId: string): Promise<Run>
  decide(runId: string, decision: string, context: string, alternatives?: string[]): Promise<Decision>
  gateCheck(runId: string, targetStage: string): Promise<GateCheckResult>
  wait(runId: string, waitingFor: string, timeout?: number): Promise<Run>
  endRunSession(runId: string): Promise<{ ok: true }>
  unassignProjectAgent(projectId: string, agentId: string, role?: string): Promise<void>
  cancelRun(runId: string, input: { reason: string; cleanupWorktree?: boolean }): Promise<RunCancelResult>
  pauseRun(runId: string, reason: string): Promise<Run>
  resumeRun(runId: string, reason: string): Promise<{ ok: boolean; runId: string; taskId: string; taskStatus: Task['status']; failReason: string | null }>
  redirectRun(runId: string, agentId: Agent['id'], reason: string): Promise<RedirectRunResult>
  retryRun(runId: string, opts?: { reason?: string }): Promise<{ ok: boolean; taskId: Task['id']; taskStatus: Task['status'] }>
  budgetExtend(runId: string, byUsd: number, reason?: string): Promise<{ ok: boolean; runId: string; taskId: string; budgetExtraUsd: number; failReason: string | null }>
  budgetDeny(runId: string, reason: string): Promise<{ ok: boolean; runId: string; taskId: string; failReason: string | null }>
  turnsExtend(runId: string, byCount: number, reason?: string): Promise<{ ok: boolean; runId: string; taskId: string; turnExtraCount: number; failReason: string | null }>
  turnsDeny(runId: string, reason: string): Promise<{ ok: boolean; runId: string; taskId: string; failReason: string | null }>
  fail(runId: string, reason: string, recoverable?: boolean): Promise<Run>
  evidence(runId: string, type: string, payload: object): Promise<Evidence>
  link(runId: string, opts: { branch?: string; commit?: string; pr?: string }): Promise<Run>
  getContext(taskId: string): Promise<RunContext>
  evaluateDAG(specId: string): Promise<{ readyTaskIds: string[] }>
  approveRun(runId: string, opts?: { reason?: string; unattended?: boolean }): Promise<{
    success: boolean
    stage: string
    reason?: string
    commitSha?: string
    branch?: string
    pushed?: boolean
    nextCommand?: string
    followupCommand?: string
  }>
  approveRunWithRebase(runId: string, opts?: { base?: string }): Promise<{
    success: boolean
    stage: string
    reason?: string
    commitSha?: string
    branch?: string
    pushed?: boolean
    preRebaseCommit?: string
    postRebaseCommit?: string
    rebaseNeeded?: boolean
    verifyPassed?: boolean
    verifyOutput?: string
    fixRebaseTaskId?: string
  }>
  getDispatcherStatus(): Promise<DispatcherStatus>
  getExecutionIntegrity(): Promise<ExecutionIntegrityReport>
  cycleDispatcher(): Promise<DispatchResult>
  cleanupWorktrees(): Promise<{ removed: number }>
  reconcileRuns(opts?: { base?: string; dryRun?: boolean }): Promise<ReconcileResult>
  rejectRun(runId: string, reason: string): Promise<Run>
  getCostBudget(): Promise<{
    perRunWarnUsd: number | null
    perRunHardUsd: number | null
    perSpecHardUsd: number | null
  }>
}

export interface WorkspaceSnapshot {
  projects: Project[]
  repositories: Repository[]
  projectAgents: ProjectAgent[]
  agents: Agent[]
  specs: Spec[]
  tasks: Task[]
  taskDependencies: TaskDependency[]
  runs: Run[]
}
