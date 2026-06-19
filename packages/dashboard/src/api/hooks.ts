import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  api,
  type AgentCreateInput,
  type AgentUpdateInput,
  type CreateBakeoffInput,
  type NotificationChannelResourceInput,
  type ProjectCreateInput,
  type ProjectRun,
  type ProjectUpdateInput,
  type RepositoryInput,
  type SearchResult,
} from './client'
import type { FactoryRuntimePatch, FactorySettingsPatch } from './factory-settings-types'

export type { SearchResult, ProjectRun }

const notificationChannelResourcesKey = ['resources', 'NotificationChannel', 'factory'] as const

function invalidateNotificationChannelDependents(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: notificationChannelResourcesKey })
  void qc.invalidateQueries({ queryKey: ['factory-settings'] })
  void qc.invalidateQueries({ queryKey: ['telegram', 'status'] })
  void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
  void qc.invalidateQueries({ queryKey: ['repair'] })
}

// Resolve (slug → full objects)
export function useResolveProject(project: string) {
  return useQuery({ queryKey: ['resolve', project], queryFn: () => api.resolveProject(project), enabled: !!project })
}
export function useResolveSpec(project: string, spec: string) {
  return useQuery({ queryKey: ['resolve', project, spec], queryFn: () => api.resolveSpec(project, spec), enabled: !!project && !!spec })
}
export function useResolveTask(project: string, spec: string, task: string) {
  return useQuery({ queryKey: ['resolve', project, spec, task], queryFn: () => api.resolveTask(project, spec, task), enabled: !!project && !!spec && !!task })
}
export function useResolveRun(project: string, spec: string, task: string, shortId: string) {
  return useQuery({ queryKey: ['resolve', project, spec, task, shortId], queryFn: () => api.resolveRun(project, spec, task, shortId), enabled: !!project && !!spec && !!task && !!shortId })
}

// Factory
export function useFactory() {
  return useQuery({ queryKey: ['factory'], queryFn: api.getFactory })
}
export function useOperatorBrief() {
  return useQuery({ queryKey: ['factory', 'operator-brief'], queryFn: api.getOperatorBrief, refetchInterval: 5000 })
}
export function useFactoryHomeViewState() {
  return useQuery({ queryKey: ['factory', 'home-view-state'], queryFn: api.getFactoryHomeViewState })
}
export function useUpdateFactoryHomeViewState() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { homeLastSeenAt: string | null }) => api.updateFactoryHomeViewState(body),
    onSuccess: (state) => {
      qc.setQueryData(['factory', 'home-view-state'], state)
    },
  })
}
export function useExecutionIntegrity() {
  return useQuery({ queryKey: ['factory', 'execution-integrity'], queryFn: api.getExecutionIntegrity, refetchInterval: 5000 })
}
export function useRepairReport() {
  return useQuery({ queryKey: ['repair'], queryFn: api.getRepairReport, refetchInterval: 5000 })
}

// Projects
export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.listProjects })
}
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProjectCreateInput) => api.createProject(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}
export function useProject(id: string) {
  return useQuery({ queryKey: ['projects', id], queryFn: () => api.getProject(id), enabled: !!id })
}
export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & ProjectUpdateInput) => api.updateProject(id, data),
    onSuccess: (project, { id }) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['projects', id] })
      void qc.invalidateQueries({ queryKey: ['resolve', project.name] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}
export function useProjectAgents(projectId: string) {
  return useQuery({ queryKey: ['projects', projectId, 'agents'], queryFn: () => api.getProjectAgents(projectId), enabled: !!projectId })
}
export function useAssignProjectAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, agentId, role }: { projectId: string; agentId: string; role: string }) =>
      api.assignProjectAgent(projectId, agentId, role),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['projects', projectId, 'agents'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}
export function useUnassignProjectAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, agentId, role }: { projectId: string; agentId: string; role: string }) =>
      api.unassignProjectAgent(projectId, agentId, role),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['projects', projectId, 'agents'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}
export function useProjectRepositories(projectId: string) {
  return useQuery({ queryKey: ['projects', projectId, 'repositories'], queryFn: () => api.listRepositories(projectId), enabled: !!projectId })
}
export function useCreateRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, repository }: { projectId: string; repository: RepositoryInput }) =>
      api.createRepository(projectId, repository),
    onSuccess: (_repo, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['projects', projectId, 'repositories'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}
export function useUpdateRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, repository }: { id: string; repository: Partial<RepositoryInput> }) =>
      api.updateRepository(id, repository),
    onSuccess: (repo) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['projects', repo.projectId, 'repositories'] })
    },
  })
}
export function useDeleteRepository() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteRepository(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}

// Project-scoped runs (enriched with task/spec/agent context)
export function useProjectRuns(projectId: string) {
  return useQuery({ queryKey: ['projects', projectId, 'runs'], queryFn: () => api.getProjectRuns(projectId), enabled: !!projectId, refetchInterval: 5000 })
}

// All tasks across all specs in a project
export function useProjectTasks(projectId: string) {
  return useQuery({ queryKey: ['projects', projectId, 'tasks'], queryFn: () => api.getProjectTasks(projectId), enabled: !!projectId })
}

// Specs
export function useSpecs(projectId: string) {
  return useQuery({ queryKey: ['specs', { projectId }], queryFn: () => api.listSpecs(projectId), enabled: !!projectId })
}
export function useSpec(id: string) {
  return useQuery({ queryKey: ['specs', id], queryFn: () => api.getSpec(id), enabled: !!id })
}

export function useBakeoffCompare(specId: string, enabled = true) {
  return useQuery({
    queryKey: ['specs', specId, 'bakeoff', 'compare'],
    queryFn: () => api.getBakeoffCompare(specId),
    enabled: enabled && !!specId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'complete' || status === 'failed' ? false : 5000
    },
  })
}

// Tasks
export function useTasks(specId: string) {
  return useQuery({ queryKey: ['tasks', { specId }], queryFn: () => api.listTasks(specId), enabled: !!specId })
}
export function useTask(id: string) {
  return useQuery({ queryKey: ['tasks', id], queryFn: () => api.getTask(id), enabled: !!id })
}
export function useTaskDeps(id: string) {
  return useQuery({ queryKey: ['tasks', id, 'deps'], queryFn: () => api.getTaskDeps(id), enabled: !!id })
}

// Runs
export function useAllRuns(params?: Record<string, string>) {
  return useQuery({ queryKey: ['runs', 'all', params], queryFn: () => api.listAllRuns(params), refetchInterval: 5000 })
}
export function useRuns(taskId: string) {
  return useQuery({ queryKey: ['runs', { taskId }], queryFn: () => api.listRuns(taskId), enabled: !!taskId })
}
export function useDispatchTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, agentId }: { taskId: string; agentId: string }) =>
      api.dispatchTask(taskId, agentId),
    onSuccess: (run, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['runs', { taskId }] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['runs', run.id] })
    },
  })
}
export function useRun(id: string) {
  return useQuery({ queryKey: ['runs', id], queryFn: () => api.getRun(id), enabled: !!id })
}
export function useRunEvidence(id: string) {
  return useQuery({ queryKey: ['runs', id, 'evidence'], queryFn: () => api.getRunEvidence(id), enabled: !!id })
}
export function useRunGateEvals(id: string) {
  return useQuery({ queryKey: ['runs', id, 'gate-evals'], queryFn: () => api.getRunGateEvals(id), enabled: !!id })
}
export function useRunHistory(id: string) {
  return useQuery({ queryKey: ['runs', id, 'history'], queryFn: () => api.getRunHistory(id), enabled: !!id })
}
export function useRunDiff(id: string, opts: { enabled?: boolean; base?: string } = {}) {
  return useQuery({
    queryKey: ['runs', id, 'diff', opts.base ?? 'main'],
    queryFn: () => api.getRunDiff(id, opts.base),
    enabled: Boolean(id) && (opts.enabled ?? true),
    // Diffs are computed by git subprocess — cache briefly so the viewer
    // doesn't hammer the API when the user toggles tabs.
    staleTime: 15_000,
    // Don't retry a 404 (no worktree) forever.
    retry: false,
  })
}
export function useRunUpdates(id: string) {
  return useQuery({ queryKey: ['runs', id, 'updates'], queryFn: () => api.getRunUpdates(id), enabled: !!id })
}
export function useRunActivity(id: string) {
  return useQuery({ queryKey: ['runs', id, 'activity'], queryFn: () => api.getRunActivity(id), enabled: !!id, refetchInterval: 3000 })
}

// Agents
export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: api.listAgents })
}

export function useModelCatalog() {
  return useQuery({ queryKey: ['models'], queryFn: api.listModels })
}

export function useTelegramStatus() {
  return useQuery({ queryKey: ['telegram', 'status'], queryFn: api.getTelegramStatus })
}

// Aggregate DB-backed Factory Settings catalogs (read-only typed view).
export function useFactorySettings() {
  return useQuery({ queryKey: ['factory-settings'], queryFn: api.getFactorySettings })
}

// Typed Factory Settings details + write path (PATCH /api/factory/settings).
export function useFactorySettingsDetails() {
  return useQuery({ queryKey: ['factory', 'settings'], queryFn: api.getFactorySettingsDetails })
}
export function useUpdateFactorySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FactorySettingsPatch) => api.patchFactorySettings(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factory', 'settings'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'runtime'] })
      void qc.invalidateQueries({ queryKey: ['factory-settings'] })
      void qc.invalidateQueries({ queryKey: ['factory'], exact: true })
    },
  })
}

// Typed runtime settings: current process facts vs desired persisted values.
export function useFactoryRuntime() {
  return useQuery({ queryKey: ['factory', 'runtime'], queryFn: api.getFactoryRuntime })
}
export function useUpdateFactoryRuntime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FactoryRuntimePatch) => api.patchFactoryRuntime(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['factory', 'runtime'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'settings'] })
    },
  })
}

// Secret metadata list. Secret writes intentionally do NOT use useMutation:
// plaintext values would persist in the mutation cache as `variables`.
// Panels call the api directly and invalidate this key (see SecretsPanel).
export function useFactorySecrets() {
  return useQuery({ queryKey: ['factory', 'secrets'], queryFn: api.listFactorySecrets })
}

export function useNotificationChannelResources() {
  return useQuery({
    queryKey: notificationChannelResourcesKey,
    queryFn: api.listNotificationChannelResources,
  })
}

export function useCreateNotificationChannelResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NotificationChannelResourceInput) => api.createNotificationChannelResource(body),
    onSuccess: () => invalidateNotificationChannelDependents(qc),
  })
}

export function useUpdateNotificationChannelResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<NotificationChannelResourceInput> }) =>
      api.updateNotificationChannelResource(id, body),
    onSuccess: () => invalidateNotificationChannelDependents(qc),
  })
}

export function useDeleteNotificationChannelResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteNotificationChannelResource(id),
    onSuccess: () => invalidateNotificationChannelDependents(qc),
  })
}

// Decisions
export function useDecisions(params: Record<string, string>) {
  return useQuery({
    queryKey: ['decisions', params],
    queryFn: () => api.listDecisions(params),
    enabled: Object.keys(params).length > 0,
  })
}

/** All decisions across the factory, unfiltered. Used by the homepage
 *  "Recent decisions" card. Capped server-side by the repo's default
 *  ordering (most recent first); the UI then slices to what it needs. */
export function useAllDecisions() {
  return useQuery({
    queryKey: ['decisions', 'all'],
    queryFn: () => api.listDecisions({}),
  })
}

// Approval mutations
export function useApproveRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: string | { runId: string; reason?: string }) => {
      const runId = typeof input === 'string' ? input : input.runId
      const result = await api.approveRun(runId, typeof input === 'string' ? {} : { reason: input.reason })
      if (!result.success) {
        throw new Error(result.reason ?? 'Approval failed')
      }
      return { result, runId }
    },
    onSuccess: ({ runId }) => {
      void qc.invalidateQueries({ queryKey: ['runs', runId] })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['resolve'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}

function invalidateRunMutation(qc: ReturnType<typeof useQueryClient>, runId: string) {
  void qc.invalidateQueries({ queryKey: ['runs', runId] })
  void qc.invalidateQueries({ queryKey: ['runs'] })
  void qc.invalidateQueries({ queryKey: ['resolve'] })
  void qc.invalidateQueries({ queryKey: ['tasks'] })
  void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
}

export function useApproveRunWithRebase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (runId: string) => {
      const result = await api.approveRunWithRebase(runId)
      if (!result.success) throw new Error(result.reason ?? 'Approve with rebase failed')
      return { result, runId }
    },
    onSuccess: ({ runId }) => {
      invalidateRunMutation(qc, runId)
      void qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}

export function useRejectRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) => api.rejectRun(runId, reason),
    onSuccess: (_data, { runId }) => {
      void qc.invalidateQueries({ queryKey: ['runs', runId] })
      void qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, reason, cleanupWorktree }: { runId: string; reason: string; cleanupWorktree?: boolean }) =>
      api.cancelRun(runId, { reason, cleanupWorktree }),
    onSuccess: (_data, { runId }) => {
      void qc.invalidateQueries({ queryKey: ['runs', runId] })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['resolve'] })
      void qc.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}

export function useRetryRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: string | { runId: string; reason?: string }) =>
      typeof input === 'string' ? api.retryRun(input) : api.retryRun(input.runId, { reason: input.reason }),
    onSuccess: (_data, input) => {
      const runId = typeof input === 'string' ? input : input.runId
      void qc.invalidateQueries({ queryKey: ['runs', runId] })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useBudgetExtend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, by, reason }: { runId: string; by: number; reason?: string }) =>
      api.budgetExtend(runId, { by, reason }),
    onSuccess: (_data, { runId }) => invalidateRunMutation(qc, runId),
  })
}

export function useBudgetDeny() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api.budgetDeny(runId, { reason }),
    onSuccess: (_data, { runId }) => invalidateRunMutation(qc, runId),
  })
}

export function useTurnsExtend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, by, reason }: { runId: string; by: number; reason?: string }) =>
      api.turnsExtend(runId, { by, reason }),
    onSuccess: (_data, { runId }) => invalidateRunMutation(qc, runId),
  })
}

export function useTurnsDeny() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api.turnsDeny(runId, { reason }),
    onSuccess: (_data, { runId }) => invalidateRunMutation(qc, runId),
  })
}

// CRUD mutations
export function useCreateSpec() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ...data }: { projectId: string; name: string; document?: string; status?: string }) =>
      api.createSpec(projectId, data),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['specs', { projectId }] })
    },
  })
}

export function useCreateBakeoff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ...data }: { projectId: string } & CreateBakeoffInput) =>
      api.createBakeoff(projectId, data),
    onSuccess: (_data, { projectId }) => {
      void qc.invalidateQueries({ queryKey: ['specs', { projectId }] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['projects', projectId, 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['specs'] })
    },
  })
}

/**
 * Cascading spec delete. Invalidates every query that could have
 * referenced tasks/runs in the deleted spec so the UI re-renders
 * without stale data.
 */
export function useDeleteSpec() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (specId: string) => api.deleteSpec(specId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['specs'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ specId, ...data }: { specId: string; name: string; prompt: string; repos?: string[]; verification?: string[]; requiredRole?: string }) =>
      api.createTask(specId, data),
    onSuccess: (_data, { specId }) => {
      void qc.invalidateQueries({ queryKey: ['tasks', { specId }] })
    },
  })
}

export function useAddTaskDependency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) =>
      api.addTaskDependency(taskId, dependsOnId),
    onSuccess: (_data, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ['tasks', taskId, 'deps'] })
    },
  })
}

export function useEvaluateDag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (specId: string) => api.evaluateDag(specId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useRegisterAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AgentCreateInput) =>
      api.registerAgent(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] })
      void qc.invalidateQueries({ queryKey: ['factory-settings'] })
    },
  })
}

export function useUpdateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & AgentUpdateInput) =>
      api.updateAgent(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] })
      void qc.invalidateQueries({ queryKey: ['factory-settings'] })
    },
  })
}

export function useDeleteAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAgent(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] })
      void qc.invalidateQueries({ queryKey: ['factory-settings'] })
    },
  })
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  })
}
