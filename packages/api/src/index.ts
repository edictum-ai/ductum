import { serve } from '@hono/node-server'
import { rm } from 'node:fs/promises'
import {
  DAGEvaluator,
  Dispatcher,
  DuctumEventEmitter,
  EnforcementManager,
  RunStateMachine,
  SqliteAgentRepo,
  SqliteConfigResourceRepo,
  SqliteEvidenceRepo,
  SqliteAttemptLeaseRepo,
  SqliteGateEvaluationRepo,
  SqliteProjectAgentRepo,
  SqliteProjectRepo,
  SqliteRepositoryRepo,
  SqliteComponentRepo,
  SqliteTargetRepo,
  SqliteRunActivityRepo,
  SqliteRunRepo,
  SqliteRunCheckpointRepo,
  SqliteFactorySecretRepo,
  FactorySecretResolver,
  formatUnknownError,
  ScopedSecretBroker,
  SqliteRunStageHistoryRepo,
  SqliteRunUpdateRepo,
  SqliteSessionRunMappingRepo,
  SqliteSpecDependencyRepo,
  SqliteSpecRepo,
  SqliteStorageBackend,
  SqliteTaskDependencyRepo,
  SqliteTaskDispatchSkipRepo,
  SqliteTaskRepo,
  SqliteFactoryRepo,
  SqliteFactoryRuntimeSettingsRepo,
  WatcherManager,
  createId,
  createSqliteTransactionRunner,
  initDb,
  loadRenderedWorkflowProfile,
  log,
  requireMaterializedWorkflowProfile,
  type AgentId,
  type RunWorkflowProfileSnapshot,
  type WorkflowProfileRuntimeData,
} from '@ductum/core'
import { parseArgs } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApp } from './app.js'
import { createApiContext, type MergeConfig } from './lib/deps.js'
import { resolveReviewCompletionText } from './lib/completion-text.js'
import { failGitHubLifecycleBeforeApproval } from './lib/github-lifecycle-failure.js'
import { syncGitHubIssueCommentForRun } from './lib/github-issue-comment-sync.js'
import { syncGitHubShipArtifacts } from './lib/github-lifecycle.js'
import { loadHarnessAdapters } from './lib/harness-loader.js'
import { buildApiTaskPrerequisiteIssues } from './lib/repair.js'
import { selectReviewerAgent } from './lib/reviewer-selection.js'
import {
  buildRuntimeReviewEvidencePayload,
  buildRuntimeVerificationEvidencePayload,
} from './lib/runtime-approval-evidence.js'
import { loadProfilesByProjectName, loadWorkflowDefsByProjectName, parseWorkflowProfilesEnv } from './workflow-profiles.js'
import { validateEnv, type DuctumConfig } from './validate-env.js'

const DEFAULT_DB_PATH = './ductum.db'
const DEFAULT_PORT = 4100

const parsed = parseArgs({
  options: {
    port: { type: 'string' },
    host: { type: 'string' },
    db: { type: 'string', default: DEFAULT_DB_PATH },
    dispatch: { type: 'boolean', default: false },
  },
})

const dbPath = parsed.values.db
const protectedDbPath = dbPath === ':memory:' ? null : resolve(dbPath)
const db = initDb(dbPath)
const startupFactory = new SqliteFactoryRepo(db).get()
const startupRuntime = startupFactory == null
  ? null
  : new SqliteFactoryRuntimeSettingsRepo(db).get(startupFactory.id)
const enableDispatch = parsed.values.dispatch && startupRuntime?.dispatcherEnabled !== false
const host = (parsed.values.host ?? process.env.DUCTUM_HOST ?? startupRuntime?.apiBindHost ?? '127.0.0.1').trim()
const port = parsePort(parsed.values.port ?? process.env.DUCTUM_PORT) ?? startupRuntime?.apiPort ?? DEFAULT_PORT
if (shouldRequireOperatorToken(host, process.env.DUCTUM_PUBLIC_BASE_URL) && !hasUsableOperatorToken()) {
  log.error('startup', 'DUCTUM_OPERATOR_TOKEN is required for public or non-local API exposure')
  process.exit(1)
}

// Validate environment before heavy initialization.
// Agents config is passed from serve.mjs via DUCTUM_AGENTS_CONFIG env var.
const agentsConfig: Record<string, { harness: string }> = (() => {
  const raw = process.env.DUCTUM_AGENTS_CONFIG
  if (raw == null) return {}
  try { return JSON.parse(raw) as Record<string, { harness: string }> } catch { return {} }
})()
validateEnv({ agents: agentsConfig } as DuctumConfig)

// Core repos
const attemptLeaseRepo = new SqliteAttemptLeaseRepo(db)
const runRepo = new SqliteRunRepo(db, attemptLeaseRepo)
const runCheckpointRepo = new SqliteRunCheckpointRepo(db, attemptLeaseRepo)
const runActivityRepo = new SqliteRunActivityRepo(db)
const runUpdateRepo = new SqliteRunUpdateRepo(db)
const runStageHistoryRepo = new SqliteRunStageHistoryRepo(db)
const evidenceRepo = new SqliteEvidenceRepo(db, attemptLeaseRepo)
const gateEvaluationRepo = new SqliteGateEvaluationRepo(db)
const taskRepo = new SqliteTaskRepo(db)
const taskDepRepo = new SqliteTaskDependencyRepo(db)
const taskDispatchSkipRepo = new SqliteTaskDispatchSkipRepo(db)
const specRepo = new SqliteSpecRepo(db)
const specDepRepo = new SqliteSpecDependencyRepo(db)
const projectRepo = new SqliteProjectRepo(db)
const repositoryRepo = new SqliteRepositoryRepo(db)
const componentRepo = new SqliteComponentRepo(db)
const targetRepo = new SqliteTargetRepo(db)
const configResourceRepo = new SqliteConfigResourceRepo(db)
const agentRepo = new SqliteAgentRepo(db)
const projectAgentRepo = new SqliteProjectAgentRepo(db)
const sessionMappingRepo = new SqliteSessionRunMappingRepo(db)

// Core services
const eventEmitter = new DuctumEventEmitter()
const stateMachine = new RunStateMachine(runRepo, runStageHistoryRepo, eventEmitter, { runCheckpointRepo })
const workflowsDir = process.env.DUCTUM_WORKFLOWS_DIR ??
  fileURLToPath(new URL('../../../workflows/', import.meta.url))
const fallbackWorkflowPath = resolve(workflowsDir, 'coding-guard.yaml')
const workflowTemplatePath = resolve(workflowsDir, 'coding-guard-template.yaml')
// Observer mode — P3. When DUCTUM_OBSERVER_MODE=true (set by the CLI
// start plan from the DB-backed Factory Settings workflow observer flag),
// the EnforcementManager evaluates workflow rules as usual but returns
// allowed=true to the caller regardless. The would-have-been decision
// is still recorded in gate_evaluations with observed=1 so operators
// can inspect "what would have blocked" without losing real work.
const observerMode = (() => {
  const raw = process.env.DUCTUM_OBSERVER_MODE
  if (raw == null) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
})()
if (observerMode) {
  log.warn('startup', 'OBSERVER MODE ACTIVE — workflow rules evaluated but NOT enforced. Gate decisions recorded with observed=1.')
}

const enforcement = new EnforcementManager({
  workflowDefsByProjectName: loadWorkflowDefsByProjectName(workflowTemplatePath),
  fallbackWorkflowPath,
  templateWorkflowPath: workflowTemplatePath,
  storageBackend: new SqliteStorageBackend(db),
  projectRepo,
  configResourceRepo,
  repositoryRepo,
  runRepo,
  sessionRunMappingRepo: sessionMappingRepo,
  specRepo,
  taskRepo,
  evidenceRepo,
  gateEvaluationRepo,
  stateMachine,
  eventEmitter,
  observerMode,
  protectedShellPaths: protectedDbPath == null ? [] : [protectedDbPath],
  gateCommitTransaction: createSqliteTransactionRunner(db),
})
await enforcement.initialize()

const resolveWorkflowProfileRuntime = (
  profile: RunWorkflowProfileSnapshot,
): WorkflowProfileRuntimeData => {
  const rendered = loadRenderedWorkflowProfile(workflowTemplatePath, profile.path)
  return {
    renderedWorkflow: rendered.renderedWorkflow,
    setupCommands: rendered.profile.setup?.commands ?? [],
    verifyCommands: rendered.profile.verify.commands,
    unattended: rendered.profile.unattended == null ? undefined : {
      autoApprove: rendered.profile.unattended.auto_approve,
      autoMerge: rendered.profile.unattended.auto_merge,
      autoPush: rendered.profile.unattended.auto_push,
      pushRequires: rendered.profile.unattended.push_requires,
    },
  }
}

const dag = new DAGEvaluator(taskRepo, taskDepRepo, specRepo, specDepRepo, runRepo, eventEmitter)
const watcherManager = new WatcherManager(runRepo, evidenceRepo, stateMachine, eventEmitter, {
  onWatcherResolved: async (runId, type, passed) => {
    if (!passed) {
      const targetStage = type === 'ci' ? 'implement' : 'implement'
      await enforcement.resetToStage(runId as never, targetStage).catch((err) => {
        log.error('watcher', `reset failed for run ${runId}: ${err instanceof Error ? err.message : err}`)
      })
      return
    }
    await enforcement.syncRunState(runId as never).catch((err) => {
      log.error('watcher', `state sync failed for run ${runId}: ${err instanceof Error ? err.message : err}`)
    })
    await syncGitHubIssueCommentForRun({
      repos: {
        runs: runRepo,
        tasks: taskRepo,
        specs: specRepo,
        repositories: repositoryRepo,
        secrets: new SqliteFactorySecretRepo(db),
        evidence: evidenceRepo,
      },
      factoryDataDir: process.env.DUCTUM_FACTORY_DATA_DIR ?? dirname(resolve(dbPath)),
      now: () => new Date(),
    }, runId as never).catch((err) => {
      log.error('watcher', `issue comment sync failed for run ${runId}: ${err instanceof Error ? err.message : err}`)
    })
  },
})

const apiUrl = `http://localhost:${Number.isFinite(port) ? port : DEFAULT_PORT}`
const mockAgentCalls = process.env.DUCTUM_MOCK_AGENT_CALLS === '1'
const { harnessAdapters, harnessLoadFailed } = await loadHarnessAdapters({
  apiUrl,
  enableDispatch,
  authorizeTool: async (runId, toolName, toolArgs) => await enforcement.authorizeTool(runId, toolName, toolArgs),
  mockAgentCalls,
})
if (mockAgentCalls) {
  log.warn('startup', 'Harnesses are running in mock-agent-calls mode; only use this for deterministic bootstrap self-tests')
}

// MCP server factory for dispatcher — each dispatched run gets its own pre-bound MCP server
let createMcpServerFactory: ((runId: string) => unknown) | undefined
if (enableDispatch) {
  try {
    const mcpModule = process.env.DUCTUM_MCP_MODULE_PATH ?? '@ductum/mcp'
    const mcp = await import(mcpModule as any) as any
    if (mcp.createMcpServer) {
      createMcpServerFactory = (runId: string) => mcp.createMcpServer(apiUrl, runId)
      log.info('startup', 'MCP: factory loaded')
    }
  } catch {
    log.warn('startup', 'MCP: @ductum/mcp not available — dispatcher cannot create MCP servers')
  }
}

// Repo name → filesystem path map (passed from serve.mjs via env)
const repoPathMap: Record<string, string> = (() => {
  const raw = process.env.DUCTUM_REPO_PATH_MAP
  if (raw == null) return {}
  try { return JSON.parse(raw) as Record<string, string> } catch { return {} }
})()

// Worktree manager for agent isolation
const worktreeConfig = (() => {
  const raw = process.env.DUCTUM_WORKTREE_CONFIG
  if (raw == null) return undefined
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return undefined }
})()

// Workflow profiles — used for setup commands in worktrees
const workflowProfiles = loadProfilesByProjectName()
if (workflowProfiles.size > 0) {
  for (const [name, profile] of workflowProfiles) {
    log.info('startup', `Workflow profile: ${name} (setup: ${profile.setup?.commands?.join(', ') ?? 'none'}, verify: ${profile.verify.commands.join(', ')})`)
  }
} else {
  log.warn('startup', 'No workflow profiles loaded (DUCTUM_WORKFLOW_PROFILES not set or empty)')
}

let worktreeManager: import('@ductum/core').WorktreeManager | undefined
if (enableDispatch && worktreeConfig?.enabled !== false) {
  const { WorktreeManager: WM } = await import('@ductum/core')
  worktreeManager = new WM(worktreeConfig as any)
  log.info('startup', `Worktrees: enabled (base: ${(worktreeConfig as any)?.basePath ?? '/tmp/ductum-worktrees'})`)
}

// Cross-agent reviewer: pick a reviewer with a different model. Prefer the
// Opus reviewer seed, then fall back to the normal routing tier.
function resolveReviewerAgent(implementingAgentId: AgentId, projectName: string): AgentId | null {
  const factoryRepo = new SqliteFactoryRepo(db)
  const factory = factoryRepo.get()
  if (factory == null) return null
  const project = projectRepo.list(factory.id).find((p) => p.name === projectName)
  if (project == null) return null
  const implementingAgent = agentRepo.get(implementingAgentId)

  const reviewerAssignments = projectAgentRepo.getByRole(project.id, 'reviewer')
  const candidates = reviewerAssignments
    .map((a) => agentRepo.get(a.agentId))
    .filter((agent) => agent != null)
  return selectReviewerAgent({ implementingAgent, candidates })?.id ?? null
}

// Heartbeat timeout from DB-backed Factory Settings → CLI start plan env
// → dispatcher config. Falls back to the dispatcher default (120s) only
// when env is unset/invalid.
const heartbeatTimeoutSeconds = (() => {
  const raw = process.env.DUCTUM_HEARTBEAT_TIMEOUT_SECONDS
  if (raw == null) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.warn('startup', `invalid DUCTUM_HEARTBEAT_TIMEOUT_SECONDS=${raw}, using default`)
    return undefined
  }
  return parsed
})()
if (heartbeatTimeoutSeconds != null) {
  log.info('startup', `Heartbeat timeout: ${heartbeatTimeoutSeconds}s (from Factory Settings)`)
}
const dispatcherHeartbeatIntervalMs = (() => {
  const raw = process.env.DUCTUM_HEARTBEAT_INTERVAL_MS
  if (raw == null) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.warn('startup', `invalid DUCTUM_HEARTBEAT_INTERVAL_MS=${raw}, using default`)
    return undefined
  }
  return parsed
})()
if (dispatcherHeartbeatIntervalMs != null) {
  log.info('startup', `Dispatcher interval: ${Math.round(dispatcherHeartbeatIntervalMs / 1000)}s (from Factory Runtime Settings)`)
}

// Scoped secret broker. Enforce by default — dispatched agents receive only an allowlisted env
// (base + per-harness credentials + their declared secret refs), never the full host environment.
// Set DUCTUM_SECRET_BROKER_MODE=warn to fall back to the legacy full-host-env behavior.
const secretBrokerMode = process.env.DUCTUM_SECRET_BROKER_MODE === 'warn' ? 'warn' : 'enforce'
const secretBroker = new ScopedSecretBroker({
  mode: secretBrokerMode,
  resolver: new FactorySecretResolver({
    factoryDir: process.env.DUCTUM_FACTORY_DATA_DIR ?? dirname(resolve(dbPath)),
    secrets: new SqliteFactorySecretRepo(db),
  }),
})

// Dispatcher
let dispatcherForRepair: Dispatcher | null = null
const dispatcher = new Dispatcher(
  dag, runRepo, taskRepo, agentRepo, projectAgentRepo, specRepo, projectRepo,
  stateMachine, watcherManager, sessionMappingRepo,
  harnessAdapters, eventEmitter,
  {
    enabled: enableDispatch && harnessAdapters.size > 0,
    ...(dispatcherHeartbeatIntervalMs != null ? { pollIntervalMs: dispatcherHeartbeatIntervalMs } : {}),
    ...(!enableDispatch
      ? { disabledReason: 'dispatch disabled: server started without --dispatch' }
      : harnessAdapters.size === 0
        ? { disabledReason: harnessLoadFailed ? 'dispatch disabled: harness adapters failed to load' : 'dispatch disabled: no harness adapters loaded' }
        : {}),
    ...(heartbeatTimeoutSeconds != null ? { heartbeatTimeoutSeconds } : {}),
    createMcpServer: createMcpServerFactory as any,
    // Resume (design/04 §1): seed a resumed run's Edictum workflow forward
    // to its checkpointed stage via the D28 setStage-forward primitive.
    seedWorkflowStage: (runId, stage) => enforcement.advanceToStage(runId as never, stage),
    resolveRepoPath: (repoName) => repoPathMap[repoName],
    resolveSetupCommands: (projectName, profile) =>
      profile == null
        ? workflowProfiles.get(projectName)?.setup?.commands
        : requireMaterializedWorkflowProfile(profile).setupCommands,
    validateWorkflowProfile: resolveWorkflowProfileRuntime,
    preDispatchCheck: (task, agent) => buildApiTaskPrerequisiteIssues(createApiContext({
      db,
      stateMachine,
      enforcement,
      dag,
      events: eventEmitter,
      merge: readMergeConfig(),
      costBudget: readCostBudget(),
      getDispatcherStatus: () => dispatcherForRepair?.status() ?? {
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: 0,
        lastCycleAt: null,
        enabled: false,
        adapterCount: 0,
        adapters: [],
        reason: 'dispatcher starting',
      },
      validateWorkflowProfile: resolveWorkflowProfileRuntime,
      factoryDataDir: process.env.DUCTUM_FACTORY_DATA_DIR ?? dirname(resolve(dbPath)),
    }), task, agent),
    materializeAgentEnv: (agent) => secretBroker.materializeEnv(agent),
  },
  worktreeManager,
  {
    resolveVerifyCommands: (projectName, profile) =>
      profile == null
        ? workflowProfiles.get(projectName)?.verify.commands
        : requireMaterializedWorkflowProfile(profile).verifyCommands,
    resolveReviewerAgent: resolveReviewerAgent,
    onVerificationResult: (runId, result) => {
      const run = runRepo.get(runId as never)
      evidenceRepo.create({
        id: createId<'EvidenceId'>(),
        runId: runId as never,
        type: 'custom',
        payload: buildRuntimeVerificationEvidencePayload(run, result),
      })
    },
    onReviewResult: (runId, result, commitSha) => {
      const run = runRepo.get(runId as never)
      evidenceRepo.create({
        id: createId<'EvidenceId'>(),
        runId: runId as never,
        type: 'custom',
        payload: buildRuntimeReviewEvidencePayload(result, commitSha),
      })
    },
    onReadyToShip: async (runId) => {
      await enforcement.advanceToStage(runId as never, 'ship')
      const run = runRepo.get(runId as never)
      const task = run == null ? null : taskRepo.get(run.taskId)
      const spec = task == null ? null : specRepo.get(task.specId)
      const requiresGitHubLifecycle = task?.source?.kind === 'github-issue' || spec?.source?.kind === 'github-issue'
      try {
        const result = await syncGitHubShipArtifacts({
          repos: {
            runs: runRepo,
            tasks: taskRepo,
            specs: specRepo,
            repositories: repositoryRepo,
            secrets: new SqliteFactorySecretRepo(db),
            evidence: evidenceRepo,
          },
          factoryDataDir: process.env.DUCTUM_FACTORY_DATA_DIR ?? dirname(resolve(dbPath)),
          now: () => new Date(),
        }, runId as never)
        if (result.skipped && requiresGitHubLifecycle) {
          const message = `GitHub issue lifecycle blocked before approval: ${result.reason ?? 'missing GitHub branch/PR sync data'}`
          failGitHubLifecycleBeforeApproval({
            stateMachine,
            runUpdates: runUpdateRepo,
          }, runId as never, message)
          return
        }
      } catch (error) {
        const message = `GitHub issue lifecycle failed before approval: ${formatUnknownError(error)}`
        failGitHubLifecycleBeforeApproval({
          stateMachine,
          runUpdates: runUpdateRepo,
        }, runId as never, message)
        return
      }
      const current = await enforcement.syncRunState(runId as never).catch(() => runRepo.get(runId as never))
      if (current != null) watcherManager.spawnWatchers(current)
    },
    resolveRunCompletionText: (runId) => {
      const id = runId as never
      return resolveReviewCompletionText(
        runActivityRepo.list(id, 100),
        runUpdateRepo.list(id),
        runRepo.get(id)?.completionSummary ?? null,
      )
    },
    maxFixIterations: 3,
    // Default to rebasing onto main before verify so parallel-agent
    // conflicts surface to the agent (who has context to fix them)
    // instead of to the human at approve time. Operators can opt out
    // by setting DUCTUM_REBASE_BASE='' explicitly.
    rebaseBase: process.env.DUCTUM_REBASE_BASE ?? 'main',
  },
  configResourceRepo,
  evidenceRepo,
  (fn) => db.transaction(fn)(),
  { repositories: repositoryRepo, components: componentRepo, targets: targetRepo, specs: specRepo },
  runCheckpointRepo,
  attemptLeaseRepo,
  runActivityRepo,
  taskDispatchSkipRepo,
)
dispatcherForRepair = dispatcher

// Late-bound dispatch callback — wired after dispatcher is created below.
// The app needs to be created first (it shares repos), but dispatch needs the dispatcher.
let dispatchTask: ((taskId: string, agentId: string) => Promise<import('@ductum/core').Run>) | undefined

// Merge config (push + target base + tag handling) from DB-backed
// Factory Settings → CLI start plan env.
const mergeConfig = readMergeConfig()
function readMergeConfig(): MergeConfig {
  const raw = process.env.DUCTUM_MERGE_CONFIG
  if (raw == null) return { push: false, base: 'main', strategy: 'merge' as const, pushTags: false }
  try {
    const parsed = JSON.parse(raw) as {
      push?: boolean
      base?: string
      strategy?: 'merge' | 'squash' | 'rebase'
      pushTags?: boolean
    }
    return {
      push: Boolean(parsed.push),
      base: typeof parsed.base === 'string' && parsed.base !== '' ? parsed.base : 'main',
      strategy:
        parsed.strategy === 'squash' || parsed.strategy === 'rebase' ? parsed.strategy : 'merge',
      pushTags: Boolean(parsed.pushTags),
    }
  } catch {
    return { push: false, base: 'main', strategy: 'merge' as const, pushTags: false }
  }
}
if (mergeConfig.push || mergeConfig.base !== 'main' || mergeConfig.pushTags || mergeConfig.strategy !== 'merge') {
  log.info(
    'startup',
    `Merge policy: push=${mergeConfig.push} base=${mergeConfig.base} strategy=${mergeConfig.strategy} pushTags=${mergeConfig.pushTags}`,
  )
}

// Cost budget config from DB-backed Factory Settings → CLI start plan
// env. Decision 120 (P3.4): `perSpecHardUsd` defaults to $200 — measured
// against the three most recent specs (`agent-first-factory-readiness`
// $145, `factory-readiness-recovery` $99 partial, `factory-resource-model`
// $128) so the cap is realistic, not punitive. Operators who want the
// prior unbounded behavior can set the per-spec cost budget to 0 (treated
// as unset by enforceCostBudget).
const DEFAULT_PER_SPEC_HARD_USD = 200
const costBudget = readCostBudget()
function readCostBudget(): Record<string, number> {
  const raw = process.env.DUCTUM_COST_BUDGET
  const result: Record<string, number> = {}
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.perRunWarnUsd === 'number') result.perRunWarnUsd = parsed.perRunWarnUsd
      if (typeof parsed.perRunHardUsd === 'number') result.perRunHardUsd = parsed.perRunHardUsd
      if (typeof parsed.perSpecHardUsd === 'number') {
        if (parsed.perSpecHardUsd > 0) result.perSpecHardUsd = parsed.perSpecHardUsd
      } else {
        result.perSpecHardUsd = DEFAULT_PER_SPEC_HARD_USD
      }
    } catch {
      result.perSpecHardUsd = DEFAULT_PER_SPEC_HARD_USD
    }
  } else {
    result.perSpecHardUsd = DEFAULT_PER_SPEC_HARD_USD
  }
  return result
}
if (Object.keys(costBudget).length > 0) {
  log.info('startup', `Cost budget: ${JSON.stringify(costBudget)}`)
}

// API
const serverPort = Number.isFinite(port) ? port : DEFAULT_PORT
const app = createApp({
  db,
  stateMachine,
  enforcement,
  dag,
  events: eventEmitter,
  merge: mergeConfig,
  costBudget,
  getDispatcherStatus: () => dispatcher.status(),
  requireDispatchPrerequisiteContext: true,
  getRuntimeConfig: () => dispatcher.runtimeConfig(),
  setHeartbeatTimeoutSeconds: (seconds) => dispatcher.setHeartbeatTimeoutSeconds(seconds),
  getAgentHealth: () => dispatcher.getAgentHealth(),
  resetAgentHealth: (nameOrId) => dispatcher.resetAgentHealth(nameOrId),
  cycleDispatcher: () => dispatcher.cycleOnce(),
  dispatchTask: !enableDispatch ? undefined : (taskId, agentId) => {
    if (dispatchTask == null) {
      const status = dispatcher.status()
      throw new Error(`Dispatch not available — ${status.reason ?? 'dispatcher not running'}`)
    }
    return dispatchTask(taskId, agentId)
  },
  cleanupWorktrees: () => dispatcher.cleanupStaleWorktrees({ force: true }),
  killRun: (runId, reason) => dispatcher.killRun(runId as never, reason),
  cleanupRunWorktrees: async (runId) => {
    const paths = runRepo.get(runId as never)?.worktreePaths ?? []
    for (const path of paths) {
      if (worktreeManager != null) await worktreeManager.remove(path)
      else await rm(path, { recursive: true, force: true }).catch(() => undefined)
    }
    return paths
  },
  endSession: (runId) => dispatcher.endSession(runId as never),
  routeStoredCompletion: (runId) => dispatcher.routeStoredCompletion(runId as never),
  hasActiveSession: (runId) => dispatcher.hasActiveSession(runId as never),
  syncExternalWatchers: (runId) => {
    const run = runRepo.get(runId as never)
    if (run != null) {
      watcherManager.spawnWatchers(run)
    }
  },
  validateWorkflowProfile: resolveWorkflowProfileRuntime,
  runtime: {
    apiBindHost: host,
    apiPort: serverPort,
    publicApiUrl: trimToNull(process.env.DUCTUM_PUBLIC_BASE_URL),
    dashboardUrl: trimToNull(process.env.DUCTUM_DASHBOARD_URL),
    dbPath: protectedDbPath ?? dbPath,
    factoryDataDir: process.env.DUCTUM_FACTORY_DATA_DIR ?? dirname(resolve(dbPath)),
    dispatcherEnabled: enableDispatch && harnessAdapters.size > 0,
    dispatcherHeartbeatIntervalSeconds: dispatcherHeartbeatIntervalMs == null
      ? undefined
      : Math.round(dispatcherHeartbeatIntervalMs / 1000),
    heartbeatTimeoutSeconds: heartbeatTimeoutSeconds ?? null,
    worktreeEnabled: worktreeConfig?.enabled !== false,
    worktreeBasePath: typeof worktreeConfig?.basePath === 'string' ? worktreeConfig.basePath : null,
    workflowProfiles: {
      entries: [
        ...[...parseWorkflowProfilesEnv()].map(([projectName, profilePath]) => ({
          source: 'env' as const,
          projectId: null,
          projectName,
          name: projectName,
          path: profilePath,
        })),
        ...configResourceRepo.list().filter((resource) => resource.kind === 'WorkflowProfile').map((resource) => {
          const spec = resource.spec as { path?: unknown }
          return {
            source: 'db' as const,
            projectId: resource.projectId,
            projectName: null,
            name: resource.name,
            path: typeof spec.path === 'string' ? spec.path : '',
          }
        }),
      ],
    },
  },
  // Decision 122 (P3.2): the approve --rebase flow needs verify
  // commands to re-run validation in the rebased worktree. Reuse the
  // same resolution path the dispatcher uses so verify stays
  // consistent across spawn-time, post-completion, and rebase-time.
  resolveVerifyCommands: (projectName, profile) =>
    profile == null
      ? workflowProfiles.get(projectName)?.verify.commands
      : requireMaterializedWorkflowProfile(profile).verifyCommands,
})

// Wire dispatch callback now that the dispatcher exists
if (enableDispatch && harnessAdapters.size > 0) {
  dispatchTask = (taskId, agentId) =>
    dispatcher.manualDispatch(taskId as never, agentId as never)
}

serve({ fetch: app.fetch, port: serverPort, hostname: host })

if (enableDispatch && harnessAdapters.size > 0) {
  // Reconcile any in-flight sessions left over by the previous server process
  // before polling. Durable lease/checkpoint state decides what is still live,
  // what resumes from checkpoint, and what must be surfaced as stalled.
  try {
    const summary = await dispatcher.reconcileOrphanedSessions()
    if (summary.scanned > 0) {
      log.info(
        'startup',
        `Orphan reconcile: scanned=${summary.scanned} live=${summary.alreadyLive} ` +
          `resumable=${summary.resumable.length} resumed=${summary.resumed.length} ` +
          `deadClaim=${summary.deadClaim.length} genuinelyStalled=${summary.genuinelyStalled.length} ` +
          `noMapping=${summary.noMapping.length} errors=${summary.errors.length}`,
      )
    }
  } catch (error) {
    log.error(
      'startup',
      `Orphan reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  dispatcher.start()
  log.info(
    'startup',
    `Dispatcher: running (${harnessAdapters.size} adapter(s), polling every ${Math.round(dispatcher.runtimeConfig().pollIntervalMs / 1000)}s)`,
  )
} else if (enableDispatch) {
  log.warn('startup', 'Dispatcher: no harness adapters available — dispatch disabled')
}

// Graceful shutdown
process.on('SIGINT', () => {
  dispatcher.stop()
  process.exit(0)
})
process.on('SIGTERM', () => {
  dispatcher.stop()
  process.exit(0)
})

function isLocalHost(value: string | undefined): boolean {
  return value == null || value === '' || value === 'localhost' || value === '127.0.0.1' || value === '::1'
}

function shouldRequireOperatorToken(hostValue: string | undefined, publicBaseUrl: string | undefined): boolean {
  if (!isLocalHost(hostValue)) return true
  if (publicBaseUrl == null || publicBaseUrl.trim() === '') return false
  try {
    return !isLocalHost(new URL(publicBaseUrl).hostname)
  } catch {
    return false
  }
}

function hasUsableOperatorToken(): boolean {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token != null && token !== '' && !['missing', 'changeme', 'replace-me', 'local-demo-token'].includes(token.toLowerCase())
}

function parsePort(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const portValue = Number(value)
  return Number.isInteger(portValue) && portValue >= 1 && portValue <= 65_535 ? portValue : null
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? null : trimmed
}
