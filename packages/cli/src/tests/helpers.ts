import { Readable, Writable } from 'node:stream'
import type { Agent, AgentHealthState, Component, ConfigResource, Decision, DispatchResult, DispatcherStatus, Evidence, Factory, FactoryDoctorReport, FactorySecretMetadata, FactorySettingsCatalogs, GateEvaluation, Project, ProjectAgent, RepairReport, Repository, Run, RunActivity, RunStageTransition, RunUpdate, Spec, Target, Task, TaskDependency } from '@ductum/core'
import { vi } from 'vitest'

import { DuctumApiError, type DuctumApi } from '../api-client.js'
import { stripAnsi } from '../format.js'
import { runCli } from '../program.js'
import type { CliProgramDeps } from '../runtime.js'

const now = '2026-04-04T12:00:00.000Z'
const stale = '2026-04-04T11:00:00.000Z'

export const factory: Factory = {
  id: 'factory-1' as Factory['id'],
  name: 'Ductum',
  config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  createdAt: now,
}

export const project: Project = {
  id: 'project-1' as Project['id'],
  factoryId: factory.id,
  name: 'ductum',
  repos: ['ductum-ai/ductum'],
  config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  createdAt: now,
  updatedAt: now,
}

export const agent: Agent = {
  id: 'agent-1' as Agent['id'],
  name: 'mimi',
  model: 'claude-opus-4.6',
  harness: 'vercel-ai',
  capabilities: ['build', 'test'],
  effort: 'xhigh',
  costTier: 90,
  spawnConfig: {},
  createdAt: now,
}

export const reviewerAgent: Agent = {
  ...agent,
  id: 'agent-reviewer' as Agent['id'],
  name: 'codex',
  model: 'gpt-5.4',
  harness: 'codex-sdk',
  capabilities: ['review', 'fix'],
  costTier: 80,
}

export const assignment: ProjectAgent = {
  projectId: project.id,
  agentId: agent.id,
  role: 'builder',
}

export const target: Target = {
  id: 'target-1' as Target['id'],
  projectId: project.id,
  name: 'ductum',
  spec: {
    source: { type: 'local', localPath: '/Users/acartagena/project/ductum' },
    branch: { base: 'main', prefix: 'feat/' },
    workflowRef: '.edictum/workflow-profile.yaml',
  },
  createdAt: now,
  updatedAt: now,
}

export const repository: Repository = {
  id: 'repository-1' as Repository['id'],
  projectId: project.id,
  name: 'ductum',
  identity: { kind: 'remote', value: 'https://github.com/edictum-ai/ductum.git', portable: true },
  portable: true,
  readiness: {
    portable: true,
    supportsLocalWorkflow: true,
    supportsRemoteWorkflow: true,
    local: { state: 'configured', path: '/Users/acartagena/project/ductum' },
    git: { state: 'configured', remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    github: { state: 'configured', owner: 'edictum-ai', repo: 'ductum' },
  },
  spec: {
    remoteUrl: 'https://github.com/edictum-ai/ductum.git',
    localPath: '/Users/acartagena/project/ductum',
  },
  createdAt: now,
  updatedAt: now,
}

export const component: Component = {
  id: 'component-1' as Component['id'],
  repositoryId: repository.id,
  name: 'cli',
  spec: { path: 'packages/cli' },
  createdAt: now,
  updatedAt: now,
}

export const configResource: ConfigResource = {
  id: 'resource-1' as ConfigResource['id'],
  kind: 'Model',
  projectId: null,
  name: 'gpt-54',
  spec: { provider: 'openai', modelId: 'gpt-5.4' },
  createdAt: now,
  updatedAt: now,
}

export const factorySettings: FactorySettingsCatalogs = {
  providers: [{ recordType: 'Provider', id: 'provider:openai', name: 'OpenAI', providerId: 'openai', label: 'OpenAI', modelCount: 1, scope: 'factory', projectId: null, source: 'derived' }],
  models: [{ recordType: 'Model', id: configResource.id, name: 'gpt-54', modelId: 'gpt-54', providerId: 'openai', providerModelId: 'gpt-5.4', scope: 'factory', projectId: null, source: 'saved' }],
  harnesses: [{ recordType: 'Harness', id: 'harness-1', name: 'codex-sdk', harnessId: 'codex-sdk', adapterType: 'codex-sdk', scope: 'factory', projectId: null, source: 'saved' }],
  workflows: [{ recordType: 'Workflow', id: 'builtin-workflow-coding-guard', name: 'coding-guard', workflowId: 'coding-guard', path: 'workflows/coding-guard-profile.yaml', scope: 'factory', projectId: null, source: 'built-in', validation: { valid: true, verifyCommands: ['pnpm test'] } }],
  agents: [{ recordType: 'Agent', id: agent.id, name: agent.name, role: 'builder', modelId: 'gpt-54', providerId: 'openai', providerModelId: 'gpt-5.4', harnessId: 'codex-sdk', harnessType: 'codex-sdk', secretAccessRefs: [], resourceRefs: {}, settings: { capabilities: agent.capabilities, effort: agent.effort ?? null, costTier: agent.costTier, spawnConfig: {} }, enabled: true, scope: 'factory', projectId: null, source: 'saved' }],
  sandboxProfiles: [{ recordType: 'SandboxProfile', id: 'sandbox-1', name: 'builder-worktree', sandboxProfileId: 'builder-worktree', provider: 'host', mode: 'worktree', scope: 'factory', projectId: null, source: 'saved' }],
  notificationChannels: [{ recordType: 'NotificationChannel', id: 'notification-1', name: 'telegram-operator', notificationChannelId: 'telegram-operator', backend: 'telegram', configured: false, scope: 'factory', projectId: null, source: 'saved' }],
  budgets: { recordType: 'BudgetPreferences', id: 'factory-budget-preferences', name: 'Factory budgets', perRunWarnUsd: null, perRunHardUsd: null, perSpecHardUsd: 200, scope: 'factory', projectId: null, source: 'saved' },
  runtimePreferences: { recordType: 'RuntimePreferences', id: 'factory-runtime-preferences', name: 'Factory runtime', defaultMergeMode: 'human', heartbeatTimeoutSeconds: 120, scope: 'factory', projectId: null, source: 'saved' },
}


export const factoryDoctorReport: FactoryDoctorReport = {
  status: 'ready',
  summary: { ready: 1, blocked: 0, deferred: 0 },
  liveSmoke: { enabled: false, status: 'skipped', reason: 'live smoke not requested' },
  agents: [{
    agentId: agent.id,
    agentName: agent.name,
    assignmentRoles: ['builder'],
    providerId: 'openai',
    modelId: 'gpt-54',
    providerModelId: 'gpt-5.4',
    harnessId: 'codex-sdk',
    harnessType: 'codex-sdk',
    accountId: null,
    status: 'ready',
    checks: [
      { kind: 'model_route', status: 'ready', message: 'route resolved: provider openai, provider model gpt-5.4, harness adapter codex-sdk' },
      { kind: 'auth', status: 'ready', message: 'provider credential env present for openai (OPENAI_API_KEY)', refs: ['OPENAI_API_KEY'] },
      { kind: 'endpoint', status: 'ready', message: 'endpoint/base URL configured via OPENAI_BASE_URL', refs: ['OPENAI_BASE_URL'] },
      { kind: 'harness_command', status: 'ready', message: 'harness command is available: codex', refs: ['codex'] },
      { kind: 'spawn_env', status: 'ready', message: 'spawn environment references are present or safely literal-free' },
    ],
  }],
}

export const factorySecret: FactorySecretMetadata = {
  id: 'secret-1',
  name: 'github-app',
  scope: 'factory',
  status: 'configured',
  createdAt: now,
  updatedAt: now,
  lastRotatedAt: now,
  lastTestedAt: null,
}

export const spec: Spec = {
  id: 'spec-1' as Spec['id'],
  projectId: project.id,
  name: 'P6',
  status: 'approved',
  strategy: 'normal',
  strategyConfig: null,
  document: '# CLI',
  maxFixIterations: null,
  createdAt: now,
  updatedAt: now,
}

export const readyTask: Task = {
  id: 'task-ready' as Task['id'],
  specId: spec.id,
  targetId: null,
  repositoryId: null,
  componentId: null,
  name: 'Ready Task',
  prompt: 'Ready work',
  repos: ['packages/cli'],
  assignedAgentId: agent.id,
  requiredRole: null,
  complexity: null,
  status: 'ready',
  strategyRole: 'normal',
  strategyGroup: null,
  verification: ['pnpm test'],
  retryCount: 0,
  retryAfter: null,
  budgetExtraUsd: 0,
  turnExtraCount: 0,
  createdAt: now,
  updatedAt: now,
}

export const activeTask: Task = {
  ...readyTask,
  id: 'task-active' as Task['id'],
  name: 'Active Task',
  status: 'active',
}

export const stalledTask: Task = {
  ...readyTask,
  id: 'task-stalled' as Task['id'],
  name: 'Stalled Task',
  status: 'active',
}

export const dependencies: TaskDependency[] = [
  { taskId: activeTask.id, dependsOnId: readyTask.id },
  { taskId: stalledTask.id, dependsOnId: activeTask.id },
]

export const activeRun = createRun(activeTask.id, 'run-active', 'implement', now)
export const stalledRun = { ...createRun(stalledTask.id, 'run-stalled', 'ship', stale), terminalState: 'stalled' as const }
export const acceptedRun = createRun(readyTask.id, 'run-accepted', 'understand', now)
export const dispatcherStatus: DispatcherStatus = {
  running: true,
  activeRuns: 1,
  maxConcurrentRuns: 3,
  lastCycleAt: now,
  enabled: true,
  adapterCount: 2,
  adapters: ['claude-agent-sdk', 'codex-sdk'],
  reason: null,
}
export const dispatchCycle: DispatchResult = {
  tasksEvaluated: 2,
  tasksDispatched: [readyTask.id],
  errors: [],
}
export const agentHealth: AgentHealthState = {
  agentId: agent.id,
  agentName: agent.name,
  recentFailures: 0,
  unhealthy: false,
  unhealthyUntil: null,
  unhealthyReason: null,
  lastFailureAt: null,
}

export function createMockApi(overrides: Partial<DuctumApi> = {}): DuctumApi {
  return {
    getFactory: vi.fn().mockResolvedValue(factory),
    initFactory: vi.fn().mockResolvedValue(factory),
    listProjects: vi.fn().mockResolvedValue([project]),
    getProject: vi.fn().mockResolvedValue(project),
    createProject: vi.fn().mockResolvedValue(project),
    intakeGitHubIssue: vi.fn().mockResolvedValue({
      recordType: 'GitHubIssueIntake',
      import: {
        disposition: 'created',
        mode: 'issue-form',
        promptDigest: null,
        reviewPrompt: null,
      },
      issue: {
        url: 'https://github.com/edictum-ai/ductum/issues/12',
        title: 'core: imported issue',
        number: 12,
        labels: ['needs-triage'],
        repository: 'edictum-ai/ductum',
      },
      spec,
      task: readyTask,
    }),
    updateProject: vi.fn().mockResolvedValue(project),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    listTargets: vi.fn().mockResolvedValue([target]),
    getTarget: vi.fn().mockResolvedValue(target),
    createTarget: vi.fn().mockResolvedValue(target),
    updateTarget: vi.fn().mockResolvedValue(target),
    deleteTarget: vi.fn().mockResolvedValue(undefined),
    listRepositories: vi.fn().mockResolvedValue([repository]),
    getRepository: vi.fn().mockResolvedValue(repository),
    createRepository: vi.fn().mockResolvedValue(repository),
    updateRepository: vi.fn().mockResolvedValue(repository),
    deleteRepository: vi.fn().mockResolvedValue(undefined),
    listFactorySecrets: vi.fn().mockResolvedValue([factorySecret]),
    getFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    createFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    updateFactorySecret: vi.fn().mockResolvedValue(factorySecret),
    deleteFactorySecret: vi.fn().mockResolvedValue(undefined),
    testFactorySecret: vi.fn().mockResolvedValue({ ...factorySecret, lastTestedAt: now }),
    listComponents: vi.fn().mockResolvedValue([component]),
    createComponent: vi.fn().mockResolvedValue(component),
    updateComponent: vi.fn().mockResolvedValue(component),
    deleteComponent: vi.fn().mockResolvedValue(undefined),
    listConfigResources: vi.fn().mockResolvedValue([configResource]),
    getConfigResource: vi.fn().mockResolvedValue(configResource),
    createConfigResource: vi.fn().mockResolvedValue(configResource),
    updateConfigResource: vi.fn().mockResolvedValue(configResource),
    deleteConfigResource: vi.fn().mockResolvedValue(undefined),
    listProjectAgents: vi.fn().mockResolvedValue([assignment]),
    assignProjectAgent: vi.fn().mockResolvedValue(assignment),
    unassignProjectAgent: vi.fn().mockResolvedValue(undefined),
    endRunSession: vi.fn().mockResolvedValue({ ok: true as const }),
    getHealth: vi.fn().mockResolvedValue({ ok: true, operatorTokenProtected: false }),
    listModels: vi.fn().mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          provider: 'openai',
          availability: 'codex',
          supportedHarnesses: ['codex-sdk'],
          defaultCostTier: 85,
          aliases: ['openai/gpt-5.4'],
          sourceUrl: 'https://example.test/gpt-5.4',
          note: 'OpenAI model',
          supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
        },
        {
          id: 'claude-sonnet-4-6',
          label: 'Claude Sonnet 4.6',
          provider: 'anthropic',
          availability: 'subscription',
          supportedHarnesses: ['claude-agent-sdk'],
          defaultCostTier: 70,
          aliases: ['claude-opus-4.6'],
          sourceUrl: 'https://example.test/claude',
          note: 'Claude model',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          id: 'glm-5.1',
          label: 'GLM-5.1',
          provider: 'zai',
          availability: 'beta',
          supportedHarnesses: ['claude-agent-sdk'],
          defaultCostTier: 10,
          aliases: ['GLM-5.1'],
          sourceUrl: 'https://example.test/glm',
          note: 'Z.AI model',
          supportedEfforts: [],
        },
      ],
      harnesses: [{ id: 'codex-sdk', label: 'Codex SDK' }],
    }),
    getFactorySettings: vi.fn().mockResolvedValue(factorySettings),
    getFactoryDoctor: vi.fn().mockResolvedValue(factoryDoctorReport),
    getRepairReport: vi.fn().mockResolvedValue(emptyRepairReport()),
    listAgents: vi.fn().mockResolvedValue([agent]),
    getAgentHealth: vi.fn().mockResolvedValue([agentHealth]),
    resetAgentHealth: vi.fn().mockResolvedValue({
      ok: true as const,
      reset: true,
      agent: { id: agent.id, name: agent.name },
    }),
    getAgent: vi.fn().mockResolvedValue(agent),
    createAgent: vi.fn().mockResolvedValue(agent),
    updateAgent: vi.fn().mockResolvedValue(agent),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    listSpecs: vi.fn().mockResolvedValue([spec]),
    getSpec: vi.fn().mockResolvedValue(spec),
    createSpec: vi.fn().mockResolvedValue(spec),
    importSpec: vi.fn().mockResolvedValue({ spec, taskCount: 1 }),
    createBakeoff: vi.fn().mockResolvedValue({
      spec: { ...spec, strategy: 'best_of_n' as const },
      candidates: [{ ...readyTask, strategyRole: 'candidate' as const, strategyGroup: 'strategy-1' }],
      reviewTask: {
        ...readyTask,
        id: 'task-review' as Task['id'],
        name: 'blind-review',
        assignedAgentId: agent.id,
        requiredRole: 'reviewer' as const,
        status: 'blocked' as const,
        strategyRole: 'blind_review' as const,
        strategyGroup: 'strategy-1',
      },
      dependencies: [{ taskId: 'task-review' as Task['id'], dependsOnId: readyTask.id }],
      policy: 'quality-gated-cost-aware',
      strategyGroup: 'strategy-1',
      reviewer: agent,
      builders: [agent],
      nextCommands: {
        watch: `ductum task list ${spec.id}`,
        compare: `ductum spec bakeoff compare ${spec.id}`,
      },
    }),
    getBakeoffCompare: vi.fn().mockResolvedValue({
      spec: { id: spec.id, projectId: spec.projectId, name: spec.name, status: spec.status },
      policy: 'quality-gated-cost-aware',
      strategyGroup: 'strategy-1',
      status: 'pending',
      candidates: [],
      reviewTask: null,
      verdict: null,
      winner: null,
      eligibility: { eligibleCount: 0, blockedCount: 0 },
      nextActions: ['Wait for candidate tasks to finish before selecting a winner.'],
    }),
    approveSpec: vi.fn().mockResolvedValue({ ...spec, status: 'approved' as const }),
    setSpecStatus: vi.fn().mockImplementation(async (_specId: string, status: string) => ({
      ...spec,
      status: status as Spec['status'],
    })),
    completeTask: vi.fn().mockImplementation(async (taskId: string, reason: string) => ({
      task: { ...readyTask, id: taskId as Task['id'], status: 'done' as const },
      alreadyDone: false,
      decision: {
        id: 'decision-task-complete' as Decision['id'],
        specId: spec.id,
        taskId: taskId as Task['id'],
        runId: null,
        decision: `operator-complete: ${reason}`,
        context: reason,
        alternatives: null,
        decidedBy: 'operator',
        supersedesId: null,
        createdAt: now,
      } as Decision,
      evidence: null,
    })),
    listTasks: vi.fn().mockImplementation(async (specId: string) =>
      specId === spec.id ? [readyTask, activeTask, stalledTask] : [],
    ),
    getTask: vi.fn().mockResolvedValue(readyTask),
    createTask: vi.fn().mockResolvedValue(readyTask),
    updateTaskPrompt: vi.fn().mockImplementation(async (taskId: string, prompt: string) => ({
      ...readyTask,
      id: taskId as Task['id'],
      prompt,
    })),
    setTaskStatus: vi.fn().mockImplementation(async (taskId: string, status: Task['status']) => ({
      ...readyTask,
      id: taskId as Task['id'],
      status,
    })),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    assignTaskAgent: vi.fn().mockResolvedValue(readyTask),
    recordImportedTaskRun: vi.fn().mockImplementation(async (taskId: string, input: { author: string; branch?: string | null; commitSha: string; sourcePath: string }) => ({
      task: { ...readyTask, id: taskId as Task['id'], status: 'done' as const },
      run: {
        ...acceptedRun,
        id: `run-import-${taskId}` as Run['id'],
        taskId: taskId as Task['id'],
        stage: 'done' as const,
        terminalState: null,
        sessionId: null,
        worktreePaths: null,
        branch: input.branch ?? 'main',
        commitSha: input.commitSha,
      },
      agent: { ...agent, id: input.author as Agent['id'], name: input.author },
      evidence: {
        id: `evidence-import-${taskId}` as Evidence['id'],
        runId: `run-import-${taskId}` as Run['id'],
        type: 'custom' as const,
        payload: {
          kind: 'bulk-import-shipped-spec',
          sourcePath: input.sourcePath,
          commitSha: input.commitSha,
          branch: input.branch ?? 'main',
        },
        createdAt: now,
      },
      alreadyRecorded: false,
    })),
    recordTaskExternalOutcome: vi.fn().mockImplementation(async (taskId: string, input: { outcome: string; reason: string; author?: string | null }) => ({
      task: { ...readyTask, id: taskId as Task['id'], status: 'done' as const },
      run: {
        ...acceptedRun,
        id: `run-outcome-${taskId}` as Run['id'],
        taskId: taskId as Task['id'],
        stage: 'done' as const,
        terminalState: null,
      },
      agent: { ...agent, id: (input.author ?? 'operator') as Agent['id'], name: input.author ?? 'operator' },
      evidence: {
        id: `evidence-outcome-${taskId}` as Evidence['id'],
        runId: `run-outcome-${taskId}` as Run['id'],
        type: 'custom' as const,
        payload: { kind: 'external-outcome', outcome: input.outcome, reason: input.reason },
        createdAt: now,
      },
      alreadyRecorded: false,
    })),
    listTaskDependencies: vi.fn().mockImplementation(async (taskId: string) =>
      dependencies.filter((item) => item.taskId === taskId),
    ),
    addTaskDependency: vi.fn().mockResolvedValue(dependencies[0]),
    listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
      if (taskId === activeTask.id) return [activeRun]
      if (taskId === stalledTask.id) return [stalledRun]
      return []
    }),
    getRun: vi.fn().mockImplementation(async (runId: string) => {
      if (runId === activeRun.id) return activeRun
      if (runId === stalledRun.id) return stalledRun
      return acceptedRun
    }),
    getRunHistory: vi.fn().mockResolvedValue([{
      id: 1,
      runId: activeRun.id,
      fromStage: 'understand',
      toStage: 'implement',
      reason: null,
      createdAt: now,
    }] as RunStageTransition[]),
    getRunEvidence: vi.fn().mockResolvedValue([{
      id: 'evidence-1' as Evidence['id'],
      runId: activeRun.id,
      type: 'test',
      payload: { command: 'pnpm test' },
      createdAt: now,
    }] as Evidence[]),
    getRunGateEvaluations: vi.fn().mockResolvedValue([{
      id: 1,
      runId: activeRun.id,
      gateType: 'gate_check',
      target: 'implement',
      result: 'allowed',
      reason: null,
      createdAt: now,
    }] as GateEvaluation[]),
    getRunUpdates: vi.fn().mockResolvedValue([
      { id: 1, runId: activeRun.id, message: 'Working', createdAt: now },
    ] as RunUpdate[]),
    getRunActivity: vi.fn().mockResolvedValue([
      { id: 1, runId: activeRun.id, kind: 'tool_call', toolName: 'shell', content: '{"command":"pnpm test"}', createdAt: now },
      { id: 2, runId: activeRun.id, kind: 'summary', toolName: null, content: 'Tests passed', createdAt: now },
    ] as RunActivity[]),
    listDecisions: vi.fn().mockResolvedValue([{
      id: 'decision-1' as Decision['id'],
      specId: spec.id,
      taskId: readyTask.id,
      runId: acceptedRun.id,
      decision: 'Use commander',
      context: 'CLI package',
      alternatives: ['yargs'],
      decidedBy: 'agent',
      supersedesId: null,
      createdAt: now,
    }] as Decision[]),
    createDecision: vi.fn().mockResolvedValue({
      id: 'decision-imported' as Decision['id'],
      specId: spec.id,
      taskId: null,
      runId: null,
      decision: 'Imported Spec Decision Trace: P6 / Decisions',
      context: '060',
      alternatives: ['decisions/060'],
      decidedBy: 'ductum-spec-import',
      supersedesId: null,
      createdAt: now,
    } as Decision),
    nextTask: vi.fn().mockResolvedValue(readyTask),
    accept: vi.fn().mockResolvedValue({ run: acceptedRun, task: readyTask }),
    dispatch: vi.fn().mockResolvedValue(activeRun),
    complete: vi.fn().mockResolvedValue({ ...acceptedRun, stage: 'done' as const }),
    update: vi.fn().mockResolvedValue({ id: 1, runId: acceptedRun.id, message: 'Working', createdAt: now } as RunUpdate),
    heartbeat: vi.fn().mockResolvedValue(activeRun),
    decide: vi.fn().mockResolvedValue({
      id: 'decision-2' as Decision['id'],
      specId: spec.id,
      taskId: readyTask.id,
      runId: acceptedRun.id,
      decision: 'Ship it',
      context: 'Done',
      alternatives: null,
      decidedBy: 'agent',
      supersedesId: null,
      createdAt: now,
    } as Decision),
    gateCheck: vi.fn().mockResolvedValue({ allowed: true, run: activeRun }),
    wait: vi.fn().mockResolvedValue({ ...activeRun, stage: 'ship' as const }),
    cancelRun: vi.fn().mockResolvedValue({
      run: { ...activeRun, terminalState: 'cancelled' as const, recoverable: false },
      cost: { tokensIn: activeRun.tokensIn, tokensOut: activeRun.tokensOut, usd: activeRun.costUsd },
      worktreePreserved: true,
      cleanupAt: null,
      evidenceId: 'evidence-cancel' as Evidence['id'],
    }),
    cleanupRunWorktree: vi.fn().mockResolvedValue({
      run: { ...activeRun, terminalState: 'failed' as const, failReason: 'original failure', worktreePaths: null },
      cleanupAt: now,
      externalOutcome: {
        runId: acceptedRun.id,
        outcome: 'fixed' as const,
        reason: 'operator fixed it elsewhere',
      },
      removedWorktreePaths: ['/tmp/ductum-worktree'],
      generatedPaths: [{
        path: '/tmp/.codex-home/run-1',
        outcome: 'removed' as const,
        reason: 'removed generated Codex home',
      }],
      branchOutcomes: [{
        branch: 'ductum/rest-api',
        outcome: 'removed' as const,
        reason: 'removed local Ductum auto branch',
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/ductum-worktree',
      }],
      evidenceId: 'evidence-cleanup' as Evidence['id'],
    }),
    pauseRun: vi.fn().mockResolvedValue({ ...activeRun, terminalState: 'paused' as const, recoverable: true }),
    resumeRun: vi.fn().mockResolvedValue({ ok: true, runId: activeRun.id, taskId: activeTask.id, taskStatus: 'ready' as const, failReason: 'operator paused' }),
    redirectRun: vi.fn().mockResolvedValue({
      ok: true,
      runId: activeRun.id,
      taskId: activeTask.id,
      taskStatus: 'ready' as const,
      fromAgentId: agent.id,
      toAgentId: reviewerAgent.id,
      toAgentName: reviewerAgent.name,
      failReason: null,
    }),
    retryRun: vi.fn().mockResolvedValue({ ok: true, taskId: activeTask.id, taskStatus: 'ready' as const }),
    budgetExtend: vi.fn().mockResolvedValue({ ok: true, runId: activeRun.id, taskId: activeTask.id, budgetExtraUsd: 0, failReason: null }),
    budgetDeny: vi.fn().mockResolvedValue({ ok: true, runId: activeRun.id, taskId: activeTask.id, failReason: 'cost_budget_denied: test' }),
    turnsExtend: vi.fn().mockResolvedValue({ ok: true, runId: activeRun.id, taskId: activeTask.id, turnExtraCount: 0, failReason: null }),
    turnsDeny: vi.fn().mockResolvedValue({ ok: true, runId: activeRun.id, taskId: activeTask.id, failReason: 'max_turns_denied: test' }),
    fail: vi.fn().mockResolvedValue({ ...activeRun, terminalState: 'failed' as const }),
    evidence: vi.fn().mockResolvedValue({
      id: 'evidence-2' as Evidence['id'],
      runId: acceptedRun.id,
      type: 'test',
      payload: {},
      createdAt: now,
    } as Evidence),
    link: vi.fn().mockResolvedValue({ ...activeRun, branch: 'feat/p6-cli', commitSha: 'abc123' }),
    getContext: vi.fn().mockResolvedValue({
      task: readyTask,
      run: acceptedRun,
      history: [],
      evidence: [],
      gateEvaluations: [],
      progressUpdates: [],
      git: { branch: 'feat/p6-cli', commitSha: 'abc123', prNumber: null, prUrl: null },
    }),
    evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['task-ready'] }),
    approveRun: vi.fn().mockResolvedValue({ success: true, stage: 'done', branch: 'feat/p6-cli', commitSha: 'abc123def', pushed: false }),
    getDispatcherStatus: vi.fn().mockResolvedValue(dispatcherStatus),
    getExecutionIntegrity: vi.fn().mockResolvedValue({
      generatedAt: now,
      summary: {
        taskCount: 0,
        runCount: 0,
        issueCount: 0,
        taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
        runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      },
      tasks: [],
      runs: [],
    }),
    cycleDispatcher: vi.fn().mockResolvedValue(dispatchCycle),
    cleanupWorktrees: vi.fn().mockResolvedValue({ removed: 0 }),
    reconcileRuns: vi.fn().mockResolvedValue({
      scannedRuns: 0,
      scannedTasks: 0,
      passes: 1,
      maxPasses: 8,
      converged: true,
      runsReconciled: [],
      tasksReconciled: [],
      sideEffectFailures: [],
      sideEffectAuditFailures: [],
      dryRun: false,
    }),
    rejectRun: vi.fn().mockResolvedValue({
      ...activeRun,
      stage: 'ship' as const,
      terminalState: 'failed' as const,
      pendingApproval: false,
    }),
    getCostBudget: vi.fn().mockResolvedValue({
      perRunWarnUsd: null,
      perRunHardUsd: null,
      perSpecHardUsd: 200,
    }),
    approveRunWithRebase: vi.fn().mockResolvedValue({
      success: true,
      stage: 'done',
      branch: 'feat/p6-cli',
      commitSha: 'abc123def-rebased',
      preRebaseCommit: 'abc123def',
      postRebaseCommit: 'abc123def-rebased',
      rebaseNeeded: true,
      verifyPassed: true,
      pushed: false,
    }),
    ...overrides,
  }
}

export function emptyRepairReport(): RepairReport {
  return {
    generatedAt: now,
    items: [],
    groups: [],
    summary: {
      total: 0,
      blockers: 0,
      attention: 0,
      byArea: {
        factory_setup: 0,
        project_readiness: 0,
        repository_readiness: 0,
        agent_readiness: 0,
        provider_auth: 0,
        workflow_validity: 0,
        spec_start: 0,
        dispatcher_visibility: 0,
        attempt_recovery: 0,
        migration: 0,
      },
    },
    projectDispatch: [],
  }
}

export async function runCommand(
  args: string[],
  api: DuctumApi = createMockApi(),
  input = '',
  deps: Partial<CliProgramDeps> = {},
) {
  const stdout = new MemoryWritable()
  const stderr = new MemoryWritable()
  const code = await runCli(['node', 'ductum', ...args], {
    api,
    stdin: Readable.from(input),
    stdout,
    stderr,
    now: () => new Date(now),
    resolveHostname: async () => undefined,
    ...deps,
  })
  return {
    code,
    stdout: stdout.toString(),
    stderr: stderr.toString(),
    text: stripAnsi(stdout.toString()),
    errorText: stripAnsi(stderr.toString()),
    api,
  }
}

export { DuctumApiError }

function createRun(taskId: Task['id'], runId: string, stage: Run['stage'], lastHeartbeat: string): Run {
  return {
    id: runId as Run['id'],
    taskId,
    agentId: agent.id,
    parentRunId: null,
    stage,
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 10,
    tokensOut: 20,
    costUsd: 1.25,
    lastHeartbeat,
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
  }
}

class MemoryWritable extends Writable {
  private chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString())
    callback()
  }

  toString() {
    return this.chunks.join('')
  }
}
