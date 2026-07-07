import {
  ConfigBackedFactoryCatalogRepo,
  SqliteAgentRepo,
  SqliteConfigResourceRepo,
  SqliteFactoryRuntimeSettingsRepo,
  SqliteFactorySecretRepo,
  SqliteFactorySecretAccessLogRepo,
  SqliteFactoryViewStateRepo,
  SqliteDecisionRepo,
  SqliteEvidenceRepo,
  SqliteAttemptLeaseRepo,
  SqliteFactoryRepo,
  SqliteGateEvaluationRepo,
  SqliteProjectAgentRepo,
  SqliteProjectRepo,
  SqliteRepositoryRepo,
  SqliteComponentRepo,
  SqliteTargetRepo,
  SqliteRunRepo,
  SqliteRunStageHistoryRepo,
  SqliteRunUpdateRepo,
  SqliteRunActivityRepo,
  SqliteSessionRunMappingRepo,
  SqliteOperatorSessionRepo,
  SqliteSpecDependencyRepo,
  SqliteSpecRepo,
  SqliteTaskDependencyRepo,
  SqliteTaskDispatchSkipRepo,
  SqliteTaskRepo,
  type DAGEvaluator,
  type DispatchResult,
  type DispatcherStatus,
  type DuctumEventEmitter,
  type EnforcementManager,
  type AgentHealthState,
  type RepairCheckStatus,
  type Run,
  type RunId,
  type RunWorkflowProfileSnapshot,
  type FactoryRuntimeWorkflowProfileConfig,
  type RepairHostChecks,
  type RunStateMachine,
  type SqliteDatabase,
  type WorkflowProfileRuntimeData,
  type FactoryRuntimeApprovalCiGate,
  type AttemptResourceCeilingSettings,
} from '@ductum/core'
import { parseTelegramConfig, type TelegramConfig } from './telegram.js'
import { HandoffTokenStore } from './handoff-tokens.js'
import { OperatorSessionStore } from './operator-session.js'

export interface ApiRepos {
  factory: SqliteFactoryRepo
  projects: SqliteProjectRepo
  projectAgents: SqliteProjectAgentRepo
  repositories: SqliteRepositoryRepo
  components: SqliteComponentRepo
  targets: SqliteTargetRepo
  configResources: SqliteConfigResourceRepo
  catalogs: ConfigBackedFactoryCatalogRepo
  runtimeSettings: SqliteFactoryRuntimeSettingsRepo
  factoryViewState: SqliteFactoryViewStateRepo
  secrets: SqliteFactorySecretRepo
  secretAccessLog: SqliteFactorySecretAccessLogRepo
  agents: SqliteAgentRepo
  specs: SqliteSpecRepo
  specDependencies: SqliteSpecDependencyRepo
  tasks: SqliteTaskRepo
  taskDependencies: SqliteTaskDependencyRepo
  taskDispatchSkips: SqliteTaskDispatchSkipRepo
  decisions: SqliteDecisionRepo
  attemptLeases: SqliteAttemptLeaseRepo
  runs: SqliteRunRepo
  runHistory: SqliteRunStageHistoryRepo
  evidence: SqliteEvidenceRepo
  gateEvaluations: SqliteGateEvaluationRepo
  sessionRunMappings: SqliteSessionRunMappingRepo
  runUpdates: SqliteRunUpdateRepo
  runActivity: SqliteRunActivityRepo
  operatorSessions: SqliteOperatorSessionRepo
}

export interface ProgressUpdate {
  message: string
  createdAt: string
}

export type MergeStrategy = 'merge' | 'squash' | 'rebase'

/** Issue #195: required-check gate config — `Partial<FactoryRuntimeApprovalCiGate>`. */
export type ApprovalCiGateConfig = Partial<FactoryRuntimeApprovalCiGate>
export interface MergeConfig {
  /** Push to origin after a successful local merge. Default: false. */
  push?: boolean
  /** Target branch to merge into. Default: "main". */
  base?: string
  /** Strategy for PR-backed `gh pr merge` approvals. Default: "merge". */
  strategy?: MergeStrategy
  /** Push tags alongside the base branch (`git push --follow-tags`). Default: false. */
  pushTags?: boolean
  /** Required CI check gate for the production GitHub App merge path. */
  approvalCiGate?: ApprovalCiGateConfig
}

export interface CostBudget {
  /** Log a warning once a single run crosses this many USD. */
  perRunWarnUsd?: number
  /** Kill the session and mark the run failed once it crosses this. */
  perRunHardUsd?: number
  /** Mark the spec failed once aggregate run cost crosses this. */
  perSpecHardUsd?: number
}

export interface ApiRuntimeObservation {
  apiBindHost?: string | null
  apiPort?: number | null
  publicApiUrl?: string | null
  dashboardUrl?: string | null
  dbPath?: string | null
  factoryDataDir?: string | null
  dispatcherEnabled?: boolean
  dispatcherHeartbeatIntervalSeconds?: number | null
  heartbeatTimeoutSeconds?: number | null
  worktreeEnabled?: boolean | null
  worktreeBasePath?: string | null
  workflowProfiles?: FactoryRuntimeWorkflowProfileConfig
}

export interface ApiRuntimeConfig {
  heartbeatTimeoutSeconds: number | null
  pollIntervalMs?: number | null
  attemptCeilings?: AttemptResourceCeilingSettings | null
  attemptCeilingsSource?: 'env' | 'factory' | null
}
export interface ApiDeps {
  db: SqliteDatabase
  stateMachine: RunStateMachine
  enforcement: EnforcementManager
  dag: DAGEvaluator
  events: DuctumEventEmitter
  now?: () => Date
  progressUpdates?: Map<RunId, ProgressUpdate[]>
  pluginProbes?: Map<string, number>
  /** Merge behavior on approval — push, target branch. */
  merge?: MergeConfig
  /** Per-run / per-spec USD spending budget. */
  costBudget?: CostBudget
  /** Manual dispatch callback — wired to Dispatcher.manualDispatch by the server entrypoint. */
  dispatchTask?: (taskId: string, agentId: string) => Promise<Run>
  /** Dispatcher runtime status for operator inspection endpoints. */
  getDispatcherStatus?: () => DispatcherStatus
  /** Fail closed before Attempt creation when prerequisite status context is absent. */
  requireDispatchPrerequisiteContext?: boolean
  /** In-memory dispatcher agent health for rotation decisions. */
  getAgentHealth?: () => AgentHealthState[]
  /** Clear in-memory dispatcher health for one agent by id or name. */
  resetAgentHealth?: (nameOrId: string) => boolean
  /** Run one dispatcher cycle on demand. */
  cycleDispatcher?: () => Promise<DispatchResult>
  getRuntimeConfig?: () => ApiRuntimeConfig
  setHeartbeatTimeoutSeconds?: (seconds: number) => void
  cleanupWorktrees?: () => Promise<number>
  killRun?: (runId: string, reason?: 'killed' | 'cancelled') => Promise<void>
  /** Best-effort orphan worker reaping for cancel when no live dispatcher session exists. */
  cleanupOrphanWorker?: (runId: string) => Promise<import('@ductum/core').OrphanWorkerCleanupResult | null>
  cleanupRunWorktrees?: (runId: string) => Promise<string[]>
  /**
   * Clean session termination triggered by `ductum.complete`.
   *
   * Aborts the agent's live harness session so exitReason='completed'
   * lands in handleSessionEnd, which then runs verify → review → ship.
   * The MCP/API completion path awaits this so accepted completion has a
   * durable routed state before the operator sees the response.
   *
   * No-op when the run has no live session.
   */
  endSession?: (runId: string) => Promise<void>
  /** Route a stored completion summary when no live session exists after restart. */
  routeStoredCompletion?: (runId: string) => Promise<void>
  hasActiveSession?: (runId: string) => boolean
  syncExternalWatchers?: (runId: RunId) => void
  /** Telegram approval notifications and webhook callbacks. */
  telegram?: TelegramConfig
  /** Factory data directory used for writable-directory repair checks. */
  factoryDataDir?: string
  /** Observed process/runtime values for current-vs-desired Settings output. */
  runtime?: ApiRuntimeObservation
  /** Test/operator override for host prerequisite checks. */
  repairChecks?: Partial<RepairHostChecks>
  /** Optional local app health probe override for repair reporting. */
  probeLocalAppHealth?: () => Promise<RepairCheckStatus>
  /** Optional bearer/header token for operator-facing API routes. */
  operatorToken?: string
  handoffTokens?: HandoffTokenStore
  operatorSessions?: OperatorSessionStore
  /** Validate a resolved WorkflowProfile before manual run creation. */
  validateWorkflowProfile?: (profile: RunWorkflowProfileSnapshot) => WorkflowProfileRuntimeData
  /**
   * Decision 122 (P3.2): the approve --rebase flow needs the same
   * verify commands the dispatcher uses to re-run verification after
   * a worktree rebase. Wired by the API server entrypoint from the
   * loaded workflow profiles map.
   */
  resolveVerifyCommands?: (projectName: string, workflowProfile?: RunWorkflowProfileSnapshot) => string[] | undefined
}
export interface ApiContext extends ApiDeps {
  repos: ApiRepos
  now: () => Date
  progressUpdates: Map<RunId, ProgressUpdate[]>
  pluginProbes: Map<string, number>
  merge: MergeConfig
  costBudget: CostBudget
  /** Run ids we've already warned about so we don't spam the log. */
  costBudgetWarned: Set<string>
  dispatchTask?: (taskId: string, agentId: string) => Promise<Run>
  getDispatcherStatus?: () => DispatcherStatus
  requireDispatchPrerequisiteContext?: boolean
  getAgentHealth?: () => AgentHealthState[]
  resetAgentHealth?: (nameOrId: string) => boolean
  cycleDispatcher?: () => Promise<DispatchResult>
  getRuntimeConfig?: () => ApiRuntimeConfig
  setHeartbeatTimeoutSeconds?: (seconds: number) => void
  hasActiveSession?: (runId: string) => boolean
  telegram: TelegramConfig
  factoryDataDir?: string
  runtime: Required<Pick<ApiRuntimeObservation, 'workflowProfiles'>> &
    Omit<ApiRuntimeObservation, 'workflowProfiles'>
  repairChecks?: Partial<RepairHostChecks>
  probeLocalAppHealth?: () => Promise<RepairCheckStatus>
  operatorToken?: string
  handoffTokens: HandoffTokenStore
  operatorSessions: OperatorSessionStore
  validateWorkflowProfile?: (profile: RunWorkflowProfileSnapshot) => WorkflowProfileRuntimeData
  resolveVerifyCommands?: (projectName: string, workflowProfile?: RunWorkflowProfileSnapshot) => string[] | undefined
}

export function createRepos(db: SqliteDatabase): ApiRepos {
  const configResources = new SqliteConfigResourceRepo(db)
  const attemptLeases = new SqliteAttemptLeaseRepo(db)
  return {
    factory: new SqliteFactoryRepo(db),
    projects: new SqliteProjectRepo(db),
    projectAgents: new SqliteProjectAgentRepo(db),
    repositories: new SqliteRepositoryRepo(db),
    components: new SqliteComponentRepo(db),
    targets: new SqliteTargetRepo(db),
    configResources,
    catalogs: new ConfigBackedFactoryCatalogRepo(configResources),
    runtimeSettings: new SqliteFactoryRuntimeSettingsRepo(db),
    factoryViewState: new SqliteFactoryViewStateRepo(db),
    secrets: new SqliteFactorySecretRepo(db),
    secretAccessLog: new SqliteFactorySecretAccessLogRepo(db),
    agents: new SqliteAgentRepo(db),
    specs: new SqliteSpecRepo(db),
    specDependencies: new SqliteSpecDependencyRepo(db),
    tasks: new SqliteTaskRepo(db),
    taskDependencies: new SqliteTaskDependencyRepo(db),
    taskDispatchSkips: new SqliteTaskDispatchSkipRepo(db),
    decisions: new SqliteDecisionRepo(db),
    attemptLeases,
    runs: new SqliteRunRepo(db, attemptLeases),
    runHistory: new SqliteRunStageHistoryRepo(db),
    evidence: new SqliteEvidenceRepo(db, attemptLeases),
    gateEvaluations: new SqliteGateEvaluationRepo(db),
    sessionRunMappings: new SqliteSessionRunMappingRepo(db),
    runUpdates: new SqliteRunUpdateRepo(db),
    runActivity: new SqliteRunActivityRepo(db),
    operatorSessions: new SqliteOperatorSessionRepo(db),
  }
}

export function createApiContext(deps: ApiDeps): ApiContext {
  const repos = createRepos(deps.db)
  return {
    ...deps,
    repos,
    now: deps.now ?? (() => new Date()),
    progressUpdates: deps.progressUpdates ?? new Map<RunId, ProgressUpdate[]>(),
    pluginProbes: deps.pluginProbes ?? new Map<string, number>(),
    merge: deps.merge ?? { push: false, base: 'main', strategy: 'merge' },
    costBudget: deps.costBudget ?? {},
    costBudgetWarned: new Set<string>(),
    telegram: deps.telegram ?? parseTelegramConfig(),
    factoryDataDir: deps.factoryDataDir ?? process.env.DUCTUM_FACTORY_DATA_DIR,
    runtime: {
      ...(deps.runtime ?? {}),
      workflowProfiles: deps.runtime?.workflowProfiles ?? { entries: [] },
    },
    repairChecks: deps.repairChecks,
    operatorToken: normalizeOperatorToken(deps.operatorToken ?? process.env.DUCTUM_OPERATOR_TOKEN),
    handoffTokens: deps.handoffTokens ?? new HandoffTokenStore(),
    operatorSessions: deps.operatorSessions ?? new OperatorSessionStore(repos.operatorSessions),
  }
}

function normalizeOperatorToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim()
  if (trimmed == null || trimmed === '') return undefined
  return ['missing', 'changeme', 'replace-me', 'local-demo-token'].includes(trimmed.toLowerCase()) ? undefined : trimmed
}
