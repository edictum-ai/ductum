import {
  ConfigBackedFactoryCatalogRepo,
  DAGEvaluator,
  DuctumEventEmitter,
  EnforcementManager,
  RunStateMachine,
  SqliteAgentRepo,
  SqliteConfigResourceRepo,
  SqliteFactoryRuntimeSettingsRepo,
  SqliteFactorySecretRepo,
  SqliteFactorySecretAccessLogRepo,
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
  SqliteRunActivityRepo,
  SqliteRunCheckpointRepo,
  SqliteRunStageHistoryRepo,
  SqliteRunUpdateRepo,
  SqliteSessionRunMappingRepo,
  SqliteSpecDependencyRepo,
  SqliteSpecRepo,
  SqliteStorageBackend,
  SqliteTaskDependencyRepo,
  SqliteTaskDispatchSkipRepo,
  SqliteTaskRepo,
  createId,
  createSqliteTransactionRunner,
  initDb,
  loadRenderedWorkflowProfile,
  type SqliteDatabase,
} from '@ductum/core'
import type { Hono } from 'hono'
import { fileURLToPath } from 'node:url'

import { createApp } from '../app.js'
import { createApiContext, type ApiContext, type ApiDeps } from '../lib/deps.js'

const workflowPath = fileURLToPath(
  new URL('../../../../workflows/coding-guard.yaml', import.meta.url),
)
const workflowTemplatePath = fileURLToPath(
  new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url),
)

export interface TestFixture {
  app: Hono
  db: SqliteDatabase
  context: ApiContext
  repos: {
    factory: SqliteFactoryRepo
    projects: SqliteProjectRepo
    projectAgents: SqliteProjectAgentRepo
    repositories: SqliteRepositoryRepo
    components: SqliteComponentRepo
    targets: SqliteTargetRepo
    configResources: SqliteConfigResourceRepo
    catalogs: ConfigBackedFactoryCatalogRepo
    runtimeSettings: SqliteFactoryRuntimeSettingsRepo
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
    runCheckpoints: SqliteRunCheckpointRepo
    runHistory: SqliteRunStageHistoryRepo
    evidence: SqliteEvidenceRepo
    gateEvaluations: SqliteGateEvaluationRepo
    sessionRunMappings: SqliteSessionRunMappingRepo
    runUpdates: SqliteRunUpdateRepo
    runActivity: SqliteRunActivityRepo
  }
  close(): void
}

function createRepos(db: SqliteDatabase) {
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
    runCheckpoints: new SqliteRunCheckpointRepo(db, attemptLeases),
    runHistory: new SqliteRunStageHistoryRepo(db),
    evidence: new SqliteEvidenceRepo(db, attemptLeases),
    gateEvaluations: new SqliteGateEvaluationRepo(db),
    sessionRunMappings: new SqliteSessionRunMappingRepo(db),
    runUpdates: new SqliteRunUpdateRepo(db),
    runActivity: new SqliteRunActivityRepo(db),
  }
}

export async function createFixture(overrides: Partial<ApiDeps> = {}): Promise<TestFixture> {
  const db = initDb(':memory:')
  const repos = createRepos(db)
  const events = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(repos.runs, repos.runHistory, events, {
    runCheckpointRepo: repos.runCheckpoints,
  })
  const enforcement = new EnforcementManager({
    fallbackWorkflowPath: workflowPath,
    templateWorkflowPath: workflowTemplatePath,
    storageBackend: new SqliteStorageBackend(db),
    projectRepo: repos.projects,
    configResourceRepo: repos.configResources,
    repositoryRepo: repos.repositories,
    runRepo: repos.runs,
    sessionRunMappingRepo: repos.sessionRunMappings,
    specRepo: repos.specs,
    taskRepo: repos.tasks,
    evidenceRepo: repos.evidence,
    gateEvaluationRepo: repos.gateEvaluations,
    stateMachine,
    eventEmitter: events,
    gateCommitTransaction: createSqliteTransactionRunner(db),
  })
  await enforcement.initialize()

  const dag = new DAGEvaluator(
    repos.tasks,
    repos.taskDependencies,
    repos.specs,
    repos.specDependencies,
    repos.runs,
    events,
  )
  const deps = {
    db,
    stateMachine,
    enforcement,
    dag,
    events,
    operatorToken: 'missing',
    validateWorkflowProfile: (profile) => {
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
    },
    ...overrides,
  } satisfies ApiDeps
  const context = createApiContext(deps)

  return {
    app: createApp(deps),
    db,
    context,
    repos,
    close() {
      db.close()
    },
  } satisfies TestFixture
}

export function seedBase(fixture: TestFixture) {
  const factory = fixture.repos.factory.create({
    id: createId<'FactoryId'>(),
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  const project = fixture.repos.projects.create({
    id: createId<'ProjectId'>(),
    factoryId: factory.id,
    name: 'ductum',
    repos: ['ductum-ai/ductum'],
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
  const builder = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name: 'mimi',
    model: 'claude-opus-4.6',
    harness: 'claude-agent-sdk',
    capabilities: ['build', 'test', 'fix'],
    costTier: 90,
    spawnConfig: { workingDir: '/tmp/ductum' },
  })
  const reviewer = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name: 'codex',
    model: 'gpt-5.4',
    harness: 'codex-sdk',
    capabilities: ['review', 'fix'],
    costTier: 80,
    spawnConfig: { port: 4097 },
  })
  fixture.repos.projectAgents.assign({ projectId: project.id, agentId: builder.id, role: 'builder' })
  fixture.repos.projectAgents.assign({ projectId: project.id, agentId: reviewer.id, role: 'reviewer' })
  const spec = fixture.repos.specs.create({
    id: createId<'SpecId'>(),
    projectId: project.id,
    name: 'P4',
    status: 'approved',
    document: '# P4',
  })
  const task = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: 'REST API',
    prompt: 'implement P4',
    repos: ['packages/api'],
    assignedAgentId: builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })

  return { factory, project, builder, reviewer, spec, task }
}

export async function requestJson(
  app: Hono,
  path: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
  } = {},
) {
  const response = await app.request(path, {
    method: options.method,
    signal: options.signal,
    headers:
      options.body === undefined
        ? options.headers
        : { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return {
    response,
    json: text === '' ? null : (JSON.parse(text) as unknown),
    text,
  }
}

export async function waitForSse(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  const decoder = new TextDecoder()
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out waiting for SSE: ${needle}`)), 2000)
  })
  let buffer = ''

  while (true) {
    const chunk = await Promise.race([reader.read(), timeout])
    if (chunk.done) {
      throw new Error(`SSE stream closed before receiving ${needle}`)
    }
    buffer += decoder.decode(chunk.value, { stream: true })
    if (buffer.includes(needle)) {
      return buffer
    }
  }
}
