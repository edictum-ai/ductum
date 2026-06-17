import type {
  FactoryRuntimeCurrentSettings,
  FactoryRuntimeDesiredSettings,
  FactoryRuntimePatch,
  FactoryRuntimeSettings,
  FactorySecretMetadata,
  FactorySettingsCatalogs,
  FactorySettingsDetails,
  FactorySettingsPatch,
  FactorySettingsWriteResult,
} from '@/api/factory-settings-types'
import { redactPublicOutput, redactPublicText } from '@ductum/public-redaction'

export type { FactorySettingsCatalogs } from '@/api/factory-settings-types'

export type FactorySettingsWrite = FactorySettingsWriteResult<FactorySettingsDetails, FactorySettingsDetails>
export type FactoryRuntimeWrite = FactorySettingsWriteResult<FactoryRuntimeCurrentSettings | null, FactoryRuntimeDesiredSettings>
export interface FactorySecretCreate {
  name: string
  value: string
  description?: string
}
export interface NotificationChannelResource {
  id: string
  kind: 'NotificationChannel'
  projectId: string | null
  name: string
  spec: {
    backend: 'telegram'
    config?: Record<string, unknown>
  }
  createdAt: string
  updatedAt: string
}
export interface NotificationChannelResourceInput {
  name: string
  projectId?: string | null
  spec: {
    backend: 'telegram'
    config?: Record<string, unknown>
  }
}

// Canonical run UI DTO types live in @ductum/api/lib/ui-contract-types.
// Re-exported here so dashboard consumers keep importing from
// '@/api/client', while the declaration site stays single (ADR 0163 §1).
export type { RunUiContract, RunUiStatusKey, UiCostState, UiTone } from '@ductum/ui-contract'
export type {
  AttemptRuntimeSnapshot,
  OperatorAgent,
  OperatorAttempt,
  OperatorAttemptSnapshot,
  OperatorComponent,
  OperatorFactoryActivity,
  OperatorHarness,
  OperatorLifecycleStatus,
  OperatorModel,
  OperatorProject,
  OperatorProvider,
  OperatorPublicRecord,
  OperatorRecordType,
  OperatorRepair,
  OperatorRepository,
  OperatorSpec,
  OperatorTask,
  OperatorWorkflow,
  PublicContractIssue,
  SpecIntake,
  SpecIntakeTask,
  WorkPackage,
} from '@ductum/operator-contract'
import type { RunUiContract } from '@ductum/ui-contract'

const API_BASE = '/api'

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: requestHeaders(body != null, path),
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    if (res.status === 401 && !path.startsWith('/internal/') && typeof window !== 'undefined') {
      // Token banner listens for this event so we don't poll and don't
      // show one-off 401s from missing scopes — just operator-token
      // failures from the auth middleware.
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path } }))
    }
    throw new ApiError(res.status, redactPublicText(text))
  }
  if (res.status === 204) return undefined as T
  const data = await res.json()
  return (path.startsWith('/internal/') ? data : redactPublicOutput(data)) as T
}

function requestHeaders(hasBody: boolean, path: string): HeadersInit | undefined {
  const headers: Record<string, string> = hasBody ? { 'Content-Type': 'application/json' } : {}
  if (path === '/internal/welcome/exchange') return headers
  const token = globalThis.localStorage?.getItem('ductum.operatorToken')?.trim()
  if (token != null && token !== '') headers['X-Ductum-Operator-Token'] = token
  return Object.keys(headers).length === 0 ? undefined : headers
}

function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  return request<T>('GET', `${path}${qs}`)
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}

function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body)
}

function patch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}

function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}

export interface Factory {
  id: string; name: string; config: { heartbeatTimeoutSeconds: number; defaultMergeMode: string }; createdAt: string
}
export interface Project {
  id: string; factoryId: string; name: string; repos: string[]; config: { mergeMode: string; workflowPath: string; workflowProfile?: string }; createdAt: string; updatedAt: string
}
export interface ProjectCreateInput {
  name: string
  repository?: RepositoryInput
  config?: { mergeMode?: string; workflowPath?: string; workflowProfile?: string; externalReviewRequired?: boolean }
}
export interface ProjectUpdateInput {
  name?: string
  repos?: string[]
  config?: { mergeMode?: string; workflowPath?: string; workflowProfile?: string; externalReviewRequired?: boolean }
}
export interface RepositoryInput {
  name: string
  spec: { remoteUrl?: string; localPath?: string; defaultBranch?: string; branchPrefix?: string }
  components?: Array<{ name: string; spec: { path?: string } }>
}
export interface Repository {
  id: string; projectId: string; name: string; portable: boolean
  spec: { remoteUrl?: string; localPath?: string; defaultBranch?: string; branchPrefix?: string }
  readiness: { supportsLocalWorkflow: boolean; supportsRemoteWorkflow: boolean }
  components?: Component[]
}
export interface Component {
  id: string; repositoryId: string; name: string; spec: { path?: string }; createdAt: string; updatedAt: string
}
export type AgentEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface AgentResourceRefs {
  modelRef?: string
  harnessRef?: string
  workflowProfileRef?: string
  sandboxRef?: string
  systemPromptRef?: string
  toolsRef?: string
  policyRef?: string
}
export interface Agent {
  id: string; name: string; model: string; harness: string; resourceRefs?: AgentResourceRefs; capabilities: string[]; effort?: AgentEffort | null; costTier: number; spawnConfig: Record<string, unknown>; pricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null; createdAt: string
}
export type AgentCreateInput = { name: string; model?: string; harness?: string; resourceRefs?: AgentResourceRefs; modelRef?: string; harnessRef?: string; sandboxRef?: string; workflowProfileRef?: string; capabilities?: string[]; effort?: AgentEffort | null }
export type AgentUpdateInput = { model?: string; harness?: string; resourceRefs?: AgentResourceRefs; modelRef?: string; harnessRef?: string; sandboxRef?: string; workflowProfileRef?: string; capabilities?: string[]; effort?: AgentEffort | null; costTier?: number; spawnConfig?: Record<string, unknown>; pricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null }
export interface HarnessOption {
  id: string
  label: string
}
export interface ModelCatalogEntry {
  id: string
  label: string
  providerModelId: string
  provider: 'openai' | 'anthropic' | 'zai'
  availability: 'api' | 'subscription' | 'codex' | 'coding-plan' | 'research-preview' | 'deprecated'
  supportedHarnesses: string[]
  defaultCostTier: number
  aliases: string[]
  sourceUrl: string
  lastVerifiedAt: string
  note: string
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number }
  pricingState: 'measured' | 'unmeasured'
  pricingNote?: string
  supportedEfforts?: AgentEffort[]
}
export interface ModelCatalog { models: ModelCatalogEntry[]; harnesses: HarnessOption[] }
export interface TelegramStatus { enabled: boolean; configured?: boolean; missing?: string[]; webhookUrl: string | null; channelRef?: string; skipped?: string; error?: string }
export interface ApproveRunResult { success: boolean; stage: string; reason?: string; commitSha?: string; branch?: string; pushed?: boolean; run?: Run }
export interface SchemaEnvelope<D> { schemaVersion: 1; kind: string; data: D; ts: string }
export interface WelcomeHandoffExchange {
  ok: true
  factoryId: string
  expiresAt: string
}
export interface WelcomeSampleSpec {
  source: { name: string; path: string }
  spec: { name: string; status: string; document: string }
  tasks: Array<{ name: string; prompt: string; repos: string[]; verification: string[] }>
}
export interface CancelRunResult {
  run: Run
  cost: { tokensIn: number; tokensOut: number; usd: number }
  worktreePreserved: boolean
  cleanupAt: string | null
  evidenceId: string
}
export interface ProjectAgent {
  projectId: string; agentId: string; role: string
}
export interface ProjectAgentAssignment {
  projectId: string
  agentId: string
  roles: string[]
}
export interface Spec {
  id: string; projectId: string; name: string; status: string; document: string; createdAt: string; updatedAt: string
  strategy?: 'normal' | 'best_of_n'
  strategyConfig?: BestOfNStrategyConfig | null
}
export interface BestOfNStrategyConfig {
  kind: 'best_of_n'
  policy: BestOfNPolicy
  strategyGroup: string
  builderAgentIds: string[]
  reviewerAgentId: string
  verify: string[]
}
export type BestOfNPolicy = 'quality-gated-cost-aware' | 'cheapest-verified-reviewed'
export type BakeoffOverallStatus = 'pending' | 'running' | 'ready_for_review' | 'reviewing' | 'complete' | 'failed'
export interface BestOfNVerdictScore { taskId: string; passed: boolean; confidence?: number; notes?: string }
export interface BestOfNVerdict {
  kind: 'best-of-n-verdict'
  winnerTaskId: string
  scores: BestOfNVerdictScore[]
  policy: BestOfNPolicy
  reason: string
}
export interface BakeoffTaskRunSummary {
  taskId: string; taskName: string; taskStatus: string; runIds: string[]
  latestRunId: string | null; latestRunStage: string | null; terminalState: string | null
  blockedReason: string | null; failReason: string | null; pendingApproval: boolean
  branch: string | null; commitSha: string | null; prUrl: string | null; worktreePaths: string[] | null
}
export interface BakeoffAgentDisplay {
  id: string; name: string; model: string; modelLabel: string | null
  provider: string | null; harness: string; effort: string | null; costTier: number
}
export interface BakeoffCandidateMetrics {
  tokensIn: number; tokensOut: number; totalTokens: number; costUsd: number
  elapsedSeconds: number | null; startedAt: string | null; updatedAt: string | null
  attempts: number; reviewPasses: number; fixRounds: number; verificationFailures: number
}
export interface BakeoffCandidateScores {
  implementation: number; review: number; tests: number; costEfficiency: number
  overall: number; reviewerConfidence: number | null
}
export interface BakeoffCandidateEligibility {
  eligible: boolean
  gates: { implementationCompleted: boolean; verifyPassed: boolean; reviewPassed: boolean; warnAccepted: boolean; safetyBlocked: boolean; artifactsAvailable: boolean }
  blockingReasons: string[]
}
export interface BakeoffCandidateCompare {
  task: BakeoffTaskRunSummary
  agent: BakeoffAgentDisplay | null
  metrics: BakeoffCandidateMetrics
  scores: BakeoffCandidateScores
  outcome: string | null
  verdictScore: BestOfNVerdictScore | null
  winner: boolean
  eligibility: BakeoffCandidateEligibility
}
export interface BakeoffCompareResponse {
  spec: { id: string; projectId: string; name: string; status: string }
  policy: BestOfNPolicy
  strategyGroup: string
  status: BakeoffOverallStatus
  candidates: BakeoffCandidateCompare[]
  reviewTask: BakeoffTaskRunSummary | null
  verdict: BestOfNVerdict | null
  winner: { taskId: string; runId: string | null; outcome: string | null; eligible: boolean } | null
  eligibility: { eligibleCount: number; blockedCount: number }
  nextActions: string[]
}
export type ExecutionMode = 'orchestrated' | 'external' | 'recorded' | 'unknown' | 'inconsistent'
export interface ExecutionIssue { code: string; message: string }
export interface ExecutionIntegrityFields {
  executionMode: ExecutionMode; executionIssues: ExecutionIssue[]
  hasDuctumLineage: boolean; hasExternalOutcome: boolean
  externalOutcome: string | null; bakeoffOutcome: string | null
}
export interface ExecutionIntegrityIssueSample {
  scope: 'task' | 'run'
  id: string
  projectName: string
  specName: string
  taskName: string
  runId: string | null
  executionMode: ExecutionMode
  issueCode: string
  issueMessage: string
  status: string
}
export interface ExecutionIntegrityTaskEntry extends ExecutionIntegrityFields {
  taskId: string
  taskName: string
  taskStatus: string
  specId: string
  specName: string
  projectName: string
  runIds: string[]
}
export interface ExecutionIntegrityRunEntry extends ExecutionIntegrityFields {
  runId: string
  taskId: string
  taskName: string
  specName: string
  projectName: string
  stage: string
  terminalState: string | null
  sessionId: string | null
  commitSha: string | null
  worktreePaths: string[] | null
}
export interface ExecutionIntegritySummary {
  taskCount: number
  runCount: number
  issueCount: number
  taskIssueCount?: number
  runIssueCount?: number
  taskModes: Record<ExecutionMode, number>
  runModes: Record<ExecutionMode, number>
  issues: ExecutionIntegrityIssueSample[]
  issuesTruncated?: boolean
}
export interface ExecutionIntegrityReport {
  generatedAt: string
  summary: ExecutionIntegritySummary
  tasks: ExecutionIntegrityTaskEntry[]
  runs: ExecutionIntegrityRunEntry[]
}
export interface OperatorBriefDispatcher {
  enabled: boolean
  running: boolean
  activeRuns: number
  maxConcurrentRuns: number
  lastCycleAt: string | null
  adapterCount: number
}
export interface OperatorBriefQueue {
  approvalsWaiting: number
  activeRuns: number
  readyTasks: number
  needsOperator: number
  integrityIssues: number
}
export interface OperatorBriefIntegrity {
  readiness: 'clear' | 'attention'
  issueCount: number
  taskIssueCount: number
  runIssueCount: number
  externalTaskCount: number
  externalRunCount: number
  taskModes: Record<ExecutionMode, number>
  runModes: Record<ExecutionMode, number>
  issues: ExecutionIntegrityIssueSample[]
  issuesTruncated?: boolean
}
export interface OperatorBriefTelegram {
  enabled: boolean
  configured: boolean
  webhookUrl?: string | null
  channelRef?: string
  skipped?: string
  error?: string
}
export interface OperatorBriefAgent {
  name: string
  model: string
  harness: string
  effort: string | null
  capabilities: string[]
}
export interface OperatorBrief {
  generatedAt: string
  staleSlotsAutoClosed?: number
  dispatcher: OperatorBriefDispatcher
  queue: OperatorBriefQueue
  integrity?: OperatorBriefIntegrity
  telegram: OperatorBriefTelegram
  agents: OperatorBriefAgent[]
  recommendedActions: string[]
}
export interface Task extends Partial<ExecutionIntegrityFields> {
  id: string; specId: string; targetId?: string | null; repositoryId?: string | null; componentId?: string | null; name: string; prompt: string; repos: string[]; assignedAgentId: string | null; requiredRole: string | null; complexity: string | null; status: string; verification: string[]; createdAt: string; updatedAt: string
  strategyRole?: 'normal' | 'candidate' | 'blind_review'
  strategyGroup?: string | null
}
export interface TaskDependency {
  taskId: string; dependsOnId: string
}
export interface Run {
  id: string; taskId: string; agentId: string; parentRunId: string | null; stage: string
  terminalState: string | null; resetCount: number; completedStages: string[]
  blockedReason: string | null; pendingApproval: boolean
  sessionId: string | null
  branch: string | null; commitSha: string | null; prNumber: number | null; prUrl: string | null
  worktreePaths: string[] | null
  ciStatus: string | null; reviewStatus: string | null; failReason: string | null; recoverable: boolean
  tokensIn: number; tokensOut: number; costUsd: number
  lastHeartbeat: string | null; heartbeatTimeoutSeconds: number
  verifyRetries?: number
  /** Agent's completion summary. Populated when stage transitions to done. */
  completionSummary: string | null
  createdAt: string; updatedAt: string
  ui?: RunUiContract
}
/**
 * Enriched run row returned by GET /api/runs. Joins task/spec/project/
 * agent context so the homepage doesn't need N+1 fetches to render.
 */
export interface EnrichedRun extends Run, ExecutionIntegrityFields {
  taskName: string
  specName: string
  projectName: string
  agentName: string
  agentModel: string
  retryCount: number
  ui?: RunUiContract
}

/**
 * Enriched run row returned by GET /api/projects/:id/runs. Scoped to a
 * single project with task/spec/agent context joined in.
 */
export interface ProjectRun extends ExecutionIntegrityFields {
  id: string
  taskId: string
  taskName: string
  specName: string
  agentId: string
  agentName: string
  agentModel: string
  retryCount: number
  stage: string
  terminalState: string | null
  pendingApproval: boolean
  failReason: string | null
  costUsd: number
  tokensIn: number
  tokensOut: number
  lastHeartbeat: string | null
  createdAt: string
  updatedAt: string
  ui?: RunUiContract
}
export interface RunStageTransition {
  id: number; runId: string; fromStage: string; toStage: string; reason: string | null; createdAt: string
}
export interface Evidence {
  id: string; runId: string; type: string; payload: Record<string, unknown>; createdAt: string
}
export interface GateEvaluation {
  id: number; runId: string; gateType: string; target: string; result: string; reason: string | null
  /** True when the row was recorded under observer mode (dry-run).
   *  The real enforcement decision was evaluated but NOT acted on. */
  observed: boolean
  createdAt: string
}
export interface Decision {
  id: string; specId: string | null; taskId: string | null; runId: string | null
  decision: string; context: string; alternatives: string[] | null; decidedBy: string
  supersedesId: string | null; createdAt: string
}
export interface RunUpdate {
  id: number; runId: string; message: string; createdAt: string
}
export interface RunActivity {
  id: number; runId: string; kind: 'tool_call' | 'tool_result' | 'text' | 'summary' | 'result'; content: string; toolName: string | null; createdAt: string
}
export interface RunDiffFile {
  path: string
  insertions: number
  deletions: number
  status: 'text' | 'binary'
}
export interface RunDiff {
  diff: string
  files: RunDiffFile[]
  totals: { files: number; insertions: number; deletions: number }
  base: string
  truncated: boolean
}
export interface SearchResult {
  type: 'run' | 'task' | 'spec' | 'project' | 'agent' | 'decision'
  id: string
  name: string
  subtitle?: string
  url: string
}
export interface CreateBakeoffInput {
  name: string
  prompt: string
  builderAgentIds: string[]
  reviewerAgentId?: string
  repositoryId?: string
  componentId?: string
  policy?: BestOfNPolicy
  verify?: string[]
}
export interface CreateBakeoffResult {
  spec: Spec
  candidates: Task[]
  reviewTask: Task
  dependencies: TaskDependency[]
  policy: BestOfNPolicy
  strategyGroup: string
  reviewer: Agent
  builders: Agent[]
  nextCommands: { watch: string; compare: string }
}
export type RepairArea =
  | 'factory_setup'
  | 'project_readiness'
  | 'repository_readiness'
  | 'agent_readiness'
  | 'provider_auth'
  | 'workflow_validity'
  | 'spec_start'
  | 'attempt_recovery'
  | 'migration'
export interface ApiRepairItem {
  id: string
  area: RepairArea
  severity: 'blocker' | 'attention'
  title: string
  reason: string
  suggestedAction: string
  record: { type: string; id: string | null; name: string | null }
  field: { path: string; label: string; value: string | null }
  blocks: string
  status: string
  issueCode: string | null
  target: {
    projectName?: string
    specName?: string
    taskName?: string
    attemptId?: string
  } | null
  href: string | null
  linkLabel: string | null
}
export interface ApiRepairGroup {
  area: RepairArea
  label: string
  blocks: string
  items: ApiRepairItem[]
}
export interface RepairReport {
  generatedAt: string
  items: ApiRepairItem[]
  groups: ApiRepairGroup[]
  summary: {
    total: number
    blockers: number
    attention: number
    byArea: Record<RepairArea, number>
  }
}
export interface FactoryHomeViewState {
  factoryId: string
  homeLastSeenAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export const api = {
  // Factory
  getFactory: () => get<Factory>('/factory'),
  getHealth: () => get<{ ok: boolean; operatorTokenProtected: boolean }>('/health'),
  detectOperatorToken: () => get<{ ok: boolean; token?: string; reason?: string }>('/internal/operator-token-detect'),
  exchangeWelcomeHandoff: (token: string) =>
    post<SchemaEnvelope<WelcomeHandoffExchange>>('/internal/welcome/exchange', { token }),
  getWelcomeSampleSpec: () => get<SchemaEnvelope<WelcomeSampleSpec>>('/welcome/sample-spec'),
  getOperatorBrief: () => get<OperatorBrief>('/factory/operator-brief'),
  getFactoryHomeViewState: () => get<FactoryHomeViewState>('/factory/home-view-state'),
  updateFactoryHomeViewState: (body: { homeLastSeenAt: string | null }) =>
    put<FactoryHomeViewState>('/factory/home-view-state', body),
  getExecutionIntegrity: () => get<ExecutionIntegrityReport>('/factory/execution-integrity'),
  getRepairReport: () => get<RepairReport>('/repair'),

  // Projects
  listProjects: () => get<Project[]>('/projects'),
  createProject: (data: ProjectCreateInput) => post<Project>('/projects', data),
  getProject: (id: string) => get<Project>(`/projects/${id}`),
  updateProject: (id: string, data: ProjectUpdateInput) => put<Project>(`/projects/${encodeURIComponent(id)}`, data),
  getProjectAgents: (id: string) => get<ProjectAgent[]>(`/projects/${id}/agents`),
  assignProjectAgent: (projectId: string, agentId: string, role: string) =>
    post<ProjectAgentAssignment>(`/projects/${projectId}/agents`, { agentId, role }),
  unassignProjectAgent: (projectId: string, agentId: string, role: string) =>
    del<void>(`/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}?${new URLSearchParams({ role })}`),
  listRepositories: (id: string) => get<Repository[]>(`/projects/${id}/repositories`),
  createRepository: (projectId: string, data: RepositoryInput) =>
    post<Repository>(`/projects/${encodeURIComponent(projectId)}/repositories`, data),
  updateRepository: (id: string, data: Partial<RepositoryInput>) =>
    put<Repository>(`/repositories/${encodeURIComponent(id)}`, data),
  deleteRepository: (id: string) => del<void>(`/repositories/${encodeURIComponent(id)}`),
  getProjectRuns: (id: string) => get<ProjectRun[]>(`/projects/${id}/runs`),
  getProjectTasks: (id: string) => get<Task[]>(`/projects/${id}/tasks`),
  createBakeoff: (projectId: string, data: CreateBakeoffInput) =>
    post<CreateBakeoffResult>(`/projects/${projectId}/bakeoffs`, data),

  // Specs
  listSpecs: (projectId: string) => get<Spec[]>(`/projects/${projectId}/specs`),
  getSpec: (id: string) => get<Spec>(`/specs/${id}`),
  getBakeoffCompare: (id: string) => get<BakeoffCompareResponse>(`/specs/${id}/bakeoff/compare`),
  importSpec: (projectId: string, body: unknown) => post<{ spec: Spec; taskCount: number }>(`/projects/${projectId}/specs/import`, body),

  // Tasks
  listTasks: (specId: string) => get<Task[]>(`/specs/${specId}/tasks`),
  getTask: (id: string) => get<Task>(`/tasks/${id}`),
  getTaskDeps: (id: string) => get<TaskDependency[]>(`/tasks/${id}/dependencies`),

  // Runs
  listAllRuns: (params?: Record<string, string>) => get<EnrichedRun[]>('/runs', params),
  listRuns: (taskId: string) => get<Run[]>(`/tasks/${taskId}/runs`),
  dispatchTask: (taskId: string, agentId: string) => post<Run>('/runs/dispatch', { taskId, agentId }),
  getRun: (id: string) => get<Run>(`/runs/${id}`),
  getRunEvidence: (id: string) => get<Evidence[]>(`/runs/${id}/evidence`),
  getRunGateEvals: (id: string) => get<GateEvaluation[]>(`/runs/${id}/gate-evaluations`),
  getRunHistory: (id: string) => get<RunStageTransition[]>(`/runs/${id}/history`),
  getRunDiff: (id: string, base?: string) =>
    get<RunDiff>(`/runs/${id}/diff`, base != null ? { base } : undefined),

  // Agents
  listAgents: () => get<Agent[]>('/agents'),
  listModels: () => get<ModelCatalog>('/models'),
  getTelegramStatus: () => get<TelegramStatus>('/telegram/status'),
  // Typed DB-backed Factory Settings surface. The aggregate read powers the
  // catalog panels; the /factory/settings and /factory/runtime pairs are the
  // typed write paths with applied/restartRequired/affectedRuntimes results.
  getFactorySettings: () => get<FactorySettingsCatalogs>('/factory-settings'),
  getFactorySettingsDetails: () => get<FactorySettingsDetails>('/factory/settings'),
  patchFactorySettings: (body: FactorySettingsPatch) => patch<FactorySettingsWrite>('/factory/settings', body),
  getFactoryRuntime: () => get<FactoryRuntimeSettings>('/factory/runtime'),
  patchFactoryRuntime: (body: FactoryRuntimePatch) => patch<FactoryRuntimeWrite>('/factory/runtime', body),
  listNotificationChannelResources: () =>
    get<NotificationChannelResource[]>('/resources/NotificationChannel', { projectId: 'factory' }),
  createNotificationChannelResource: (body: NotificationChannelResourceInput) =>
    post<NotificationChannelResource>('/resources/NotificationChannel', body),
  updateNotificationChannelResource: (id: string, body: Partial<NotificationChannelResourceInput>) =>
    put<NotificationChannelResource>(`/resources/NotificationChannel/${encodeURIComponent(id)}`, body),
  deleteNotificationChannelResource: (id: string) =>
    del<void>(`/resources/NotificationChannel/${encodeURIComponent(id)}`),

  // Encrypted write-only secrets. Reads return metadata only; plaintext is
  // accepted by create/update and never returned by any API afterwards.
  listFactorySecrets: () => get<FactorySecretMetadata[]>('/factory/secrets'),
  createFactorySecret: (body: FactorySecretCreate) => post<FactorySecretMetadata>('/factory/secrets', body),
  updateFactorySecret: (id: string, body: { name?: string; value?: string; description?: string }) =>
    patch<FactorySecretMetadata>(`/factory/secrets/${encodeURIComponent(id)}`, body),
  deleteFactorySecret: (id: string) => del<void>(`/factory/secrets/${encodeURIComponent(id)}`),
  testFactorySecret: (id: string) => post<FactorySecretMetadata>(`/factory/secrets/${encodeURIComponent(id)}/test`),

  // Decisions
  listDecisions: (params: Record<string, string>) => get<Decision[]>('/decisions', params),

  // Run updates (progress messages)
  getRunUpdates: (id: string) => get<RunUpdate[]>(`/runs/${id}/updates`),

  // Run activity (agent tool calls, text, summaries)
  getRunActivity: (id: string) => get<RunActivity[]>(`/runs/${id}/activity`),

  // Approvals
  approveRun: (runId: string) => post<ApproveRunResult>(`/runs/${runId}/approve`),
  rejectRun: (runId: string, reason: string) => post<Run>(`/runs/${runId}/reject`, { reason }),
  cancelRun: async (runId: string, body: { reason: string; cleanupWorktree?: boolean }) =>
    (await post<SchemaEnvelope<CancelRunResult>>(`/runs/${runId}/cancel`, body)).data,

  // Retry
  retryRun: (runId: string) => post<{ ok: boolean; taskId: string }>(`/runs/${runId}/retry`),

  // Resolve (slug → full objects)
  resolveProject: (project: string) =>
    get<{ project: Project }>(`/resolve/${encodeURIComponent(project)}`),
  resolveSpec: (project: string, spec: string) =>
    get<{ project: Project; spec: Spec }>(`/resolve/${encodeURIComponent(project)}/${encodeURIComponent(spec)}`),
  resolveTask: (project: string, spec: string, task: string) =>
    get<{ project: Project; spec: Spec; task: Task }>(`/resolve/${encodeURIComponent(project)}/${encodeURIComponent(spec)}/${encodeURIComponent(task)}`),
  resolveRun: (project: string, spec: string, task: string, shortId: string) =>
    get<{ project: Project; spec: Spec; task: Task; run: Run }>(`/resolve/${encodeURIComponent(project)}/${encodeURIComponent(spec)}/${encodeURIComponent(task)}/${encodeURIComponent(shortId)}`),
  resolveRunById: (runId: string) =>
    get<{ project: Project; spec: Spec; task: Task; run: Run }>(`/resolve/runs/${encodeURIComponent(runId)}`),

  // CRUD
  createSpec: (projectId: string, data: { name: string; document?: string; status?: string }) =>
    post<Spec>(`/projects/${projectId}/specs`, data),
  /**
   * Cascading delete. Removes the spec, every task in it, every run
   * under those tasks, and every child row (activity, evidence,
   * mappings, etc.). Returns the counts so the UI can render a
   * confirmation toast.
   */
  deleteSpec: (specId: string) =>
    del<{ specId: string; tasksDeleted: number; runsDeleted: number; runsKilled: number }>(
      `/specs/${encodeURIComponent(specId)}`,
    ),
  createTask: (specId: string, data: { name: string; prompt: string; repos?: string[]; verification?: string[]; requiredRole?: string }) =>
    post<Task>(`/specs/${specId}/tasks`, data),
  addTaskDependency: (taskId: string, dependsOnId: string) =>
    post<TaskDependency>(`/tasks/${taskId}/dependencies`, { dependsOnId }),
  evaluateDag: (specId: string) =>
    post<{ evaluated: number }>('/tasks/evaluate-dag', { specId }),
  registerAgent: (data: AgentCreateInput) =>
    post<Agent>('/agents', data),
  updateAgent: (id: string, data: AgentUpdateInput) =>
    put<Agent>(`/agents/${id}`, data),
  deleteAgent: (id: string) => del<void>(`/agents/${id}`),

  // Search
  search: (q: string) => get<SearchResult[]>('/search', q.length > 0 ? { q } : {}),
}
