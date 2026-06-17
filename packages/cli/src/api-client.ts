import type {
  Agent,
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
  RepairReport,
} from '@ductum/core'

import type {
  AcceptedTaskRun,
  TaskCompleteResult,
  CreateAgentInput,
  CreateBakeoffInput,
  CreateBakeoffResult,
  CreateProjectInput,
  CreateSpecInput,
  CreateTaskInput,
  CreateTargetInput,
  CreateRepositoryInput,
  CreateComponentInput,
  CreateConfigResourceInput,
  DuctumApi,
  ExecutionIntegrityReport,
  GateCheckResult,
  HealthStatus,
  ReconcileResult,
  RecordImportedTaskRunInput,
  RecordImportedTaskRunResult,
  RunCancelResult,
  RunContext,
  SchemaEnvelope,
  ModelCatalog,
  AgentHealthResetResult,
  BakeoffCompareResponse,
  UpdateAgentInput,
  UpdateProjectInput,
  UpdateTargetInput,
  UpdateRepositoryInput,
  UpdateComponentInput,
  UpdateConfigResourceInput,
} from './types.js'
import { apiRequest, pathWithQuery, DuctumApiError } from './api-request.js'

export type { DuctumApi } from './types.js'
export { DuctumApiError } from './api-request.js'

export class DuctumApiClient implements DuctumApi {
  constructor(private readonly baseUrl: string) {}

  getFactory() { return this.request<Factory | null>('/api/factory', { allow404: true }) }
  initFactory(input?: Partial<Pick<Factory, 'name'>> & { config?: Partial<Factory['config']> }) {
    return this.request<Factory>('/api/factory', { method: 'PUT', body: input ?? {} })
  }
  listProjects() { return this.request<Project[]>('/api/projects') }
  getProject(id: string) { return this.request<Project>(`/api/projects/${encodeURIComponent(id)}`) }
  createProject(input: CreateProjectInput) { return this.request<Project>('/api/projects', { method: 'POST', body: input }) }
  updateProject(id: string, input: UpdateProjectInput) {
    return this.request<Project>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteProject(id: string) { return this.request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  listTargets(projectId: string) {
    return this.request<Target[]>(`/api/projects/${encodeURIComponent(projectId)}/targets`)
  }
  getTarget(id: string) { return this.request<Target>(`/api/targets/${encodeURIComponent(id)}`) }
  createTarget(projectId: string, input: CreateTargetInput) {
    return this.request<Target>(`/api/projects/${encodeURIComponent(projectId)}/targets`, { method: 'POST', body: input })
  }
  updateTarget(id: string, input: UpdateTargetInput) {
    return this.request<Target>(`/api/targets/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteTarget(id: string) { return this.request<void>(`/api/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  listRepositories(projectId: string) {
    return this.request<Repository[]>(`/api/projects/${encodeURIComponent(projectId)}/repositories`)
  }
  getRepository(id: string) { return this.request<Repository>(`/api/repositories/${encodeURIComponent(id)}`) }
  createRepository(projectId: string, input: CreateRepositoryInput) {
    return this.request<Repository>(`/api/projects/${encodeURIComponent(projectId)}/repositories`, {
      method: 'POST',
      body: input,
    })
  }
  updateRepository(id: string, input: UpdateRepositoryInput) {
    return this.request<Repository>(`/api/repositories/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteRepository(id: string) {
    return this.request<void>(`/api/repositories/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
  listComponents(repositoryId: string) {
    return this.request<Component[]>(`/api/repositories/${encodeURIComponent(repositoryId)}/components`)
  }
  createComponent(repositoryId: string, input: CreateComponentInput) {
    return this.request<Component>(`/api/repositories/${encodeURIComponent(repositoryId)}/components`, {
      method: 'POST',
      body: input,
    })
  }
  updateComponent(id: string, input: UpdateComponentInput) {
    return this.request<Component>(`/api/components/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteComponent(id: string) { return this.request<void>(`/api/components/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  listConfigResources(kind: ConfigResourceKind, projectId?: string | null) {
    return this.request<ConfigResource[]>(
      pathWithQuery(`/api/resources/${encodeURIComponent(kind)}`, {
        projectId: projectId === null ? 'factory' : projectId ?? undefined,
      }),
    )
  }
  getConfigResource(kind: ConfigResourceKind, id: string) {
    return this.request<ConfigResource>(`/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`)
  }
  createConfigResource(kind: ConfigResourceKind, input: CreateConfigResourceInput) {
    return this.request<ConfigResource>(`/api/resources/${encodeURIComponent(kind)}`, { method: 'POST', body: input })
  }
  updateConfigResource(kind: ConfigResourceKind, id: string, input: UpdateConfigResourceInput) {
    return this.request<ConfigResource>(`/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteConfigResource(kind: ConfigResourceKind, id: string) {
    return this.request<void>(`/api/resources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
  listProjectAgents(projectId: string) {
    return this.request<ProjectAgent[]>(`/api/projects/${encodeURIComponent(projectId)}/agents`)
  }
  assignProjectAgent(projectId: string, agentId: string, role: string) {
    return this.request<ProjectAgent>(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
      method: 'POST',
      body: { agentId, role },
    })
  }
  getHealth() { return this.request<HealthStatus>('/api/health') }
  listModels() { return this.request<ModelCatalog>('/api/models') }
  getFactorySettings() { return this.request<FactorySettingsCatalogs>('/api/factory-settings') }
  getRepairReport() { return this.request<RepairReport>('/api/repair') }
  listAgents() { return this.request<Agent[]>('/api/agents') }
  async getAgentHealth() {
    const response = await this.request<{ agents: AgentHealthState[] }>('/api/agents/health')
    return response.agents
  }
  resetAgentHealth(nameOrId: string) {
    return this.request<AgentHealthResetResult>(
      `/api/agents/${encodeURIComponent(nameOrId)}/health/reset`,
      { method: 'POST' },
    )
  }
  getAgent(id: string) { return this.request<Agent>(`/api/agents/${encodeURIComponent(id)}`) }
  createAgent(input: CreateAgentInput) { return this.request<Agent>('/api/agents', { method: 'POST', body: input }) }
  updateAgent(id: string, input: UpdateAgentInput) {
    return this.request<Agent>(`/api/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: input })
  }
  deleteAgent(id: string) { return this.request<void>(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  listSpecs(projectId: string) { return this.request<Spec[]>(`/api/projects/${encodeURIComponent(projectId)}/specs`) }
  getSpec(id: string) { return this.request<Spec>(`/api/specs/${encodeURIComponent(id)}`) }
  createSpec(projectId: string, input: CreateSpecInput) {
    return this.request<Spec>(`/api/projects/${encodeURIComponent(projectId)}/specs`, { method: 'POST', body: input })
  }
  createBakeoff(projectId: string, input: CreateBakeoffInput) {
    return this.request<CreateBakeoffResult>(`/api/projects/${encodeURIComponent(projectId)}/bakeoffs`, {
      method: 'POST',
      body: input,
    })
  }
  getBakeoffCompare(specId: string) {
    return this.request<BakeoffCompareResponse>(`/api/specs/${encodeURIComponent(specId)}/bakeoff/compare`)
  }
  approveSpec(specId: string) {
    return this.request<Spec>(`/api/specs/${encodeURIComponent(specId)}/status`, {
      method: 'PUT',
      body: { status: 'approved' },
    })
  }
  setSpecStatus(specId: string, status: string) {
    return this.request<Spec>(`/api/specs/${encodeURIComponent(specId)}/status`, {
      method: 'PUT',
      body: { status },
    })
  }
  completeTask(taskId: string, reason: string) {
    return this.request<TaskCompleteResult>(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
      method: 'POST',
      body: { reason },
    })
  }
  listTasks(specId: string) { return this.request<Task[]>(`/api/specs/${encodeURIComponent(specId)}/tasks`) }
  getTask(taskId: string) { return this.request<Task>(`/api/tasks/${encodeURIComponent(taskId)}`) }
  createTask(specId: string, input: CreateTaskInput) {
    return this.request<Task>(`/api/specs/${encodeURIComponent(specId)}/tasks`, { method: 'POST', body: input })
  }
  updateTaskPrompt(taskId: string, prompt: string) {
    return this.request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/prompt`, {
      method: 'PUT',
      body: { prompt },
    })
  }
  setTaskStatus(taskId: string, status: Task['status']) {
    return this.request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'PUT',
      body: { status },
    })
  }
  deleteTask(taskId: string) { return this.request<void>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }) }
  assignTaskAgent(taskId: string, agentId: string) {
    return this.request<Task>(`/api/tasks/${encodeURIComponent(taskId)}/agent`, { method: 'PUT', body: { agentId } })
  }
  recordImportedTaskRun(taskId: string, input: RecordImportedTaskRunInput) {
    return this.request<RecordImportedTaskRunResult>(`/api/tasks/${encodeURIComponent(taskId)}/recorded-run`, {
      method: 'POST',
      body: input,
    })
  }
  listTaskDependencies(taskId: string) {
    return this.request<TaskDependency[]>(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`)
  }
  addTaskDependency(taskId: string, dependsOnId: string) {
    return this.request<TaskDependency>(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
      method: 'POST',
      body: { dependsOnId },
    })
  }
  listTaskRuns(taskId: string) { return this.request<Run[]>(`/api/tasks/${encodeURIComponent(taskId)}/runs`) }
  getRun(runId: string) { return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}`) }
  getRunHistory(runId: string) { return this.request<RunStageTransition[]>(`/api/runs/${encodeURIComponent(runId)}/history`) }
  getRunEvidence(runId: string) { return this.request<Evidence[]>(`/api/runs/${encodeURIComponent(runId)}/evidence`) }
  getRunGateEvaluations(runId: string) {
    return this.request<GateEvaluation[]>(`/api/runs/${encodeURIComponent(runId)}/gate-evaluations`)
  }
  getRunUpdates(runId: string) {
    return this.request<RunUpdate[]>(`/api/runs/${encodeURIComponent(runId)}/updates`)
  }
  getRunActivity(runId: string, limit?: number) {
    const query = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : ''
    return this.request<RunActivity[]>(`/api/runs/${encodeURIComponent(runId)}/activity${query}`)
  }
  listDecisions(filters: { specId?: string; taskId?: string; runId?: string } = {}) {
    return this.request<Decision[]>(pathWithQuery('/api/decisions', filters))
  }
  createDecision(input: { specId?: string; taskId?: string; runId?: string; decision: string; context: string; alternatives?: string[]; decidedBy: string; supersedesId?: string }) {
    return this.request<Decision>('/api/decisions', { method: 'POST', body: input })
  }
  nextTask(project?: string, role?: string) {
    return this.request<Task | null>('/api/runs/next-task', {
      method: 'POST',
      body: { ...(project == null ? {} : { projectId: project }), ...(role == null ? {} : { role }) },
    })
  }

  async accept(taskId: string): Promise<AcceptedTaskRun> {
    const task = await this.getTask(taskId)
    if (task.assignedAgentId == null) {
      throw new Error(`Task ${taskId} does not have an assigned agent`)
    }
    const run = await this.request<Run>('/api/runs/accept', {
      method: 'POST',
      body: { taskId, agentId: task.assignedAgentId },
    })
    return { run, task }
  }

  dispatch(taskId: string, agentId: string) {
    return this.request<Run>('/api/runs/dispatch', {
      method: 'POST',
      body: { taskId, agentId },
    })
  }

  async complete(runId: string, result: string, pr?: string) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/complete`, {
      method: 'POST',
      body: { result, ...(pr == null || pr === '' ? {} : { pr }) },
    })
  }

  async update(runId: string, message: string) {
    const response = await this.request<{ runId: string; update: RunUpdate }>(
      `/api/runs/${encodeURIComponent(runId)}/update`,
      { method: 'POST', body: { message } },
    )
    return response.update
  }

  heartbeat(runId: string) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/heartbeat`, { method: 'POST' })
  }
  approveRun(runId: string) {
    return this.request<{
      success: boolean
      stage: string
      reason?: string
      commitSha?: string
      branch?: string
      pushed?: boolean
      nextCommand?: string
      followupCommand?: string
    }>(`/api/runs/${encodeURIComponent(runId)}/approve`, { method: 'POST' })
  }
  approveRunWithRebase(runId: string, opts: { base?: string } = {}) {
    return this.request<{
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
    }>(`/api/runs/${encodeURIComponent(runId)}/approve-rebase`, {
      method: 'POST',
      body: opts,
    })
  }
  getDispatcherStatus() { return this.request<DispatcherStatus>('/api/factory/dispatcher') }
  getExecutionIntegrity() { return this.request<ExecutionIntegrityReport>('/api/factory/execution-integrity') }
  cycleDispatcher() { return this.request<DispatchResult>('/api/factory/dispatcher/cycle', { method: 'POST' }) }
  cleanupWorktrees() {
    return this.request<{ removed: number }>('/api/factory/cleanup-worktrees', { method: 'POST' })
  }
  getCostBudget() {
    return this.request<{
      perRunWarnUsd: number | null
      perRunHardUsd: number | null
      perSpecHardUsd: number | null
    }>('/api/factory/cost-budget')
  }
  reconcileRuns(opts: { base?: string; dryRun?: boolean } = {}) { return this.request<ReconcileResult>('/api/runs/reconcile', { method: 'POST', body: opts }) }
  rejectRun(runId: string, reason: string) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/reject`, { method: 'POST', body: { reason } })
  }
  decide(runId: string, decision: string, context: string, alternatives?: string[]) {
    return this.request<Decision>(`/api/runs/${encodeURIComponent(runId)}/decide`, {
      method: 'POST',
      body: { decision, context, ...(alternatives == null ? {} : { alternatives }) },
    })
  }

  async gateCheck(runId: string, targetStage: string): Promise<GateCheckResult> {
    try {
      const run = await this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/gate-check`, {
        method: 'POST',
        body: { targetStage },
      })
      return { allowed: true, run }
    } catch (error) {
      if (error instanceof DuctumApiError && [400, 403, 409].includes(error.status)) {
        return { allowed: false, reason: error.message }
      }
      throw error
    }
  }

  wait(runId: string, waitingFor: string, timeout?: number) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/wait`, {
      method: 'POST',
      body: { waitingFor, ...(timeout == null ? {} : { timeout }) },
    })
  }
  endRunSession(runId: string) {
    return this.request<{ ok: true }>(`/api/runs/${encodeURIComponent(runId)}/end-session`, {
      method: 'POST',
    })
  }
  unassignProjectAgent(projectId: string, agentId: string, role?: string) {
    const path = `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`
    const query = role == null ? '' : `?role=${encodeURIComponent(role)}`
    return this.request<void>(`${path}${query}`, { method: 'DELETE' })
  }
  async cancelRun(runId: string, input: { reason: string; cleanupWorktree?: boolean }) {
    const response = await this.request<SchemaEnvelope<'run.cancelled', RunCancelResult>>(
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: 'POST',
        body: {
          reason: input.reason,
          cleanupWorktree: input.cleanupWorktree === true,
        },
      },
    )
    return response.data
  }
  retryRun(runId: string) {
    return this.request<{ ok: boolean; taskId: Task['id']; taskStatus: Task['status'] }>(
      `/api/runs/${encodeURIComponent(runId)}/retry`,
      { method: 'POST' },
    )
  }
  budgetExtend(runId: string, byUsd: number, reason?: string) {
    return this.request<{ ok: boolean; runId: string; taskId: string; budgetExtraUsd: number; failReason: string | null }>(
      `/api/runs/${encodeURIComponent(runId)}/budget-extend`,
      { method: 'POST', body: { by: byUsd, ...(reason == null ? {} : { reason }) } },
    )
  }
  budgetDeny(runId: string, reason: string) {
    return this.request<{ ok: boolean; runId: string; taskId: string; failReason: string | null }>(
      `/api/runs/${encodeURIComponent(runId)}/budget-deny`,
      { method: 'POST', body: { reason } },
    )
  }
  turnsExtend(runId: string, byCount: number, reason?: string) {
    return this.request<{ ok: boolean; runId: string; taskId: string; turnExtraCount: number; failReason: string | null }>(
      `/api/runs/${encodeURIComponent(runId)}/turns-extend`,
      { method: 'POST', body: { by: byCount, ...(reason == null ? {} : { reason }) } },
    )
  }
  turnsDeny(runId: string, reason: string) {
    return this.request<{ ok: boolean; runId: string; taskId: string; failReason: string | null }>(
      `/api/runs/${encodeURIComponent(runId)}/turns-deny`,
      { method: 'POST', body: { reason } },
    )
  }
  fail(runId: string, reason: string, recoverable?: boolean) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/fail`, {
      method: 'POST',
      body: { reason, ...(recoverable == null ? {} : { recoverable }) },
    })
  }
  evidence(runId: string, type: string, payload: object) {
    return this.request<Evidence>(`/api/runs/${encodeURIComponent(runId)}/evidence`, {
      method: 'POST',
      body: { type, payload },
    })
  }
  link(runId: string, opts: { branch?: string; commit?: string; pr?: string }) {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/link`, { method: 'POST', body: opts })
  }
  getContext(taskId: string) { return this.request<RunContext>(`/api/tasks/${encodeURIComponent(taskId)}/context`) }
  evaluateDAG(specId: string) { return this.request<{ readyTaskIds: string[] }>('/api/tasks/evaluate-dag', { method: 'POST', body: { specId } }) }

  private request<T>(path: string, init: { method?: string; body?: unknown; allow404?: boolean } = {}) {
    return apiRequest<T>(this.baseUrl, path, init)
  }
}
