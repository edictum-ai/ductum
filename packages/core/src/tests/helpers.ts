import {
  createId,
  initDb,
  SqliteAgentRepo,
  SqliteConfigResourceRepo,
  SqliteDecisionRepo,
  SqliteEvidenceRepo,
  SqliteFactoryRepo,
  SqliteGateEvaluationRepo,
  SqliteProjectAgentRepo,
  SqliteProjectRepo,
  SqliteRepositoryRepo,
  SqliteComponentRepo,
  SqliteTargetRepo,
  SqliteRunRepo,
  SqliteRunCheckpointRepo,
  SqliteRunStageHistoryRepo,
  SqliteSessionRunMappingRepo,
  SqliteSpecDependencyRepo,
  SqliteSpecRepo,
  SqliteTaskDependencyRepo,
  SqliteTaskRepo,
  type Agent,
  type Factory,
  type Project,
  type SqliteDatabase,
  type Spec,
} from '../index.js'

export interface RepoContext {
  db: SqliteDatabase
  factoryRepo: SqliteFactoryRepo
  projectRepo: SqliteProjectRepo
  agentRepo: SqliteAgentRepo
  projectAgentRepo: SqliteProjectAgentRepo
  repositoryRepo: SqliteRepositoryRepo
  componentRepo: SqliteComponentRepo
  targetRepo: SqliteTargetRepo
  configResourceRepo: SqliteConfigResourceRepo
  specRepo: SqliteSpecRepo
  specDependencyRepo: SqliteSpecDependencyRepo
  taskRepo: SqliteTaskRepo
  taskDependencyRepo: SqliteTaskDependencyRepo
  decisionRepo: SqliteDecisionRepo
  runRepo: SqliteRunRepo
  runCheckpointRepo: SqliteRunCheckpointRepo
  runStageHistoryRepo: SqliteRunStageHistoryRepo
  evidenceRepo: SqliteEvidenceRepo
  gateEvaluationRepo: SqliteGateEvaluationRepo
  sessionRunMappingRepo: SqliteSessionRunMappingRepo
}

export function createRepoContext(): RepoContext {
  const db = initDb(':memory:')

  return {
    db,
    factoryRepo: new SqliteFactoryRepo(db),
    projectRepo: new SqliteProjectRepo(db),
    agentRepo: new SqliteAgentRepo(db),
    projectAgentRepo: new SqliteProjectAgentRepo(db),
    repositoryRepo: new SqliteRepositoryRepo(db),
    componentRepo: new SqliteComponentRepo(db),
    targetRepo: new SqliteTargetRepo(db),
    configResourceRepo: new SqliteConfigResourceRepo(db),
    specRepo: new SqliteSpecRepo(db),
    specDependencyRepo: new SqliteSpecDependencyRepo(db),
    taskRepo: new SqliteTaskRepo(db),
    taskDependencyRepo: new SqliteTaskDependencyRepo(db),
    decisionRepo: new SqliteDecisionRepo(db),
    runRepo: new SqliteRunRepo(db),
    runCheckpointRepo: new SqliteRunCheckpointRepo(db),
    runStageHistoryRepo: new SqliteRunStageHistoryRepo(db),
    evidenceRepo: new SqliteEvidenceRepo(db),
    gateEvaluationRepo: new SqliteGateEvaluationRepo(db),
    sessionRunMappingRepo: new SqliteSessionRunMappingRepo(db),
  }
}

export function createIds() {
  return {
    factoryId: createId<'FactoryId'>(),
    projectId: createId<'ProjectId'>(),
    targetId: createId<'TargetId'>(),
    configResourceId: createId<'ConfigResourceId'>(),
    specId: createId<'SpecId'>(),
    specId2: createId<'SpecId'>(),
    taskId: createId<'TaskId'>(),
    taskId2: createId<'TaskId'>(),
    taskId3: createId<'TaskId'>(),
    taskId4: createId<'TaskId'>(),
    agentId: createId<'AgentId'>(),
    reviewerId: createId<'AgentId'>(),
    runId: createId<'RunId'>(),
    runId2: createId<'RunId'>(),
    decisionId: createId<'DecisionId'>(),
    evidenceId: createId<'EvidenceId'>(),
  }
}

export function seedBase(context: RepoContext): {
  factory: Factory
  project: Project
  builder: Agent
  reviewer: Agent
  spec: Spec
} {
  const ids = createIds()
  const factory = context.factoryRepo.create({
    id: ids.factoryId,
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  const project = context.projectRepo.create({
    id: ids.projectId,
    factoryId: factory.id,
    name: 'edictum',
    repos: ['edictum-ai/edictum-ts'],
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
  const builder = context.agentRepo.create({
    id: ids.agentId,
    name: 'mimi',
    model: 'claude-opus-4.6',
    harness: 'claude-agent-sdk',
    capabilities: ['build', 'test'],
    costTier: 90,
    spawnConfig: { workingDir: '/tmp/ductum' },
  })
  const reviewer = context.agentRepo.create({
    id: ids.reviewerId,
    name: 'codex',
    model: 'gpt-5.4',
    harness: 'vercel-ai',
    capabilities: ['review', 'fix'],
    costTier: 80,
    spawnConfig: { port: 4097, env: { OPENAI_API_KEY: 'test' } },
  })

  context.projectAgentRepo.assign({ projectId: project.id, agentId: builder.id, role: 'builder' })
  context.projectAgentRepo.assign({ projectId: project.id, agentId: reviewer.id, role: 'reviewer' })

  const spec = context.specRepo.create({
    id: ids.specId,
    projectId: project.id,
    name: 'P1',
    status: 'approved',
    document: '# P1',
  })

  return { factory, project, builder, reviewer, spec }
}
