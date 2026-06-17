import { join } from 'node:path'

import { MODEL_REGISTRY, providerModelIdForEntry, resolveModelEntry } from './model-registry.js'
import type { Component, ConfigResource, HarnessSpec, Repository } from './resource-types.js'
import type { SqliteDatabase } from './db-migrations.js'
import {
  createId,
  type Agent,
  type Factory,
  type Project,
} from './types.js'
import { SqliteAgentRepo } from './repos/agent.js'
import { SqliteConfigResourceRepo } from './repos/config-resource.js'
import { SqliteFactoryRepo } from './repos/factory.js'
import { SqliteProjectAgentRepo, SqliteProjectRepo } from './repos/project.js'
import { SqliteComponentRepo, SqliteRepositoryRepo } from './repos/repository.js'
import { SqliteFactoryRuntimeSettingsRepo } from './repos/runtime-settings.js'

export type InitialFactoryAgentProvider = 'anthropic' | 'codex' | 'copilot'

export interface InitialFactorySeedInput {
  db: SqliteDatabase
  factoryDir: string
  projectName: string
  agents?: InitialFactoryAgentProvider[]
}

export interface InitialFactorySeedResult {
  factory: Factory
  project: Project
  repository: Repository
  component: Component
  agents: Agent[]
  assignments: number
  catalogs: {
    models: number
    harnesses: number
    workflows: number
    sandboxProfiles: number
  }
}

type SeededAgent = { agent: Agent; roles: Array<'builder' | 'reviewer'> }
type SeedAgentSpec = {
  name: string
  modelRef: string
  providerModelId: string
  harness: string
  capabilities: Agent['capabilities']
  effort: Agent['effort']
  roles: Array<'builder' | 'reviewer'>
  costTier: number
}

const DEFAULT_FACTORY_CONFIG = {
  heartbeatTimeoutSeconds: 120,
  defaultMergeMode: 'human' as const,
  costBudget: { perSpecHardUsd: 200 },
}

const BUILT_IN_HARNESSES: Array<{ name: string; spec: HarnessSpec }> = [
  { name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: 'claude', controlMode: 'sdk', supportedSandboxes: ['worktree'] } },
  { name: 'codex-app-server', spec: { type: 'codex-app-server', command: 'codex', controlMode: 'app-server', supportedSandboxes: ['worktree'] } },
  { name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex', controlMode: 'sdk', supportedSandboxes: ['worktree'] } },
  { name: 'copilot-sdk', spec: { type: 'copilot-sdk', command: 'gh copilot', controlMode: 'sdk', supportedSandboxes: ['worktree'] } },
]

export function seedInitialFactoryDatabase(input: InitialFactorySeedInput): InitialFactorySeedResult {
  const repos = createSeedRepos(input.db)
  const existing = repos.factories.get()
  if (existing != null) throw new Error(`Factory database already contains Factory state: ${existing.name}`)

  return input.db.transaction(() => {
    const factory = repos.factories.create({
      id: createId<'FactoryId'>(),
      name: input.projectName,
      config: DEFAULT_FACTORY_CONFIG as Factory['config'],
    })
    repos.runtimeSettings.upsert(factory.id, {
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      dispatcherEnabled: true,
      dispatcherHeartbeatIntervalSeconds: 30,
      worktreeEnabled: true,
      worktreeBasePath: join(input.factoryDir, '.ductum', 'worktrees'),
    })
    const project = seedProject(repos, factory, input.projectName)
    const repository = repos.repositories.create({
      id: createId<'RepositoryId'>() as Repository['id'],
      projectId: project.id,
      name: '.',
      spec: { localPath: '.', defaultBranch: 'main', branchPrefix: 'feat/' },
    })
    const component = repos.components.create({
      id: createId<'ComponentId'>() as Component['id'],
      repositoryId: repository.id,
      name: 'root',
      spec: { path: '.' },
    })
    const catalogs = seedCatalogs(repos.configResources)
    const seededAgents = seedAgents(repos, input.agents ?? [])
    let assignments = 0
    for (const { agent, roles } of seededAgents) {
      for (const role of roles) {
        repos.projectAgents.assign({ projectId: project.id, agentId: agent.id, role })
        assignments++
      }
    }
    return { factory, project, repository, component, agents: seededAgents.map(({ agent }) => agent), assignments, catalogs }
  })()
}

function createSeedRepos(db: SqliteDatabase) {
  return {
    factories: new SqliteFactoryRepo(db),
    projects: new SqliteProjectRepo(db),
    repositories: new SqliteRepositoryRepo(db),
    components: new SqliteComponentRepo(db),
    agents: new SqliteAgentRepo(db),
    projectAgents: new SqliteProjectAgentRepo(db),
    configResources: new SqliteConfigResourceRepo(db),
    runtimeSettings: new SqliteFactoryRuntimeSettingsRepo(db),
  }
}

function seedProject(repos: ReturnType<typeof createSeedRepos>, factory: Factory, projectName: string): Project {
  return repos.projects.create({
    id: createId<'ProjectId'>(),
    factoryId: factory.id,
    name: projectName,
    repos: ['.'],
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
}

function seedCatalogs(configResources: SqliteConfigResourceRepo): InitialFactorySeedResult['catalogs'] {
  for (const model of modelCatalogEntries()) {
    configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'Model',
      projectId: null,
      name: model.name,
      spec: model.spec,
    })
  }
  for (const harness of BUILT_IN_HARNESSES) {
    configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'Harness',
      projectId: null,
      name: harness.name,
      spec: harness.spec,
    })
  }
  configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'WorkflowProfile',
    projectId: null,
    name: 'coding-guard',
    spec: {
      path: 'workflows/coding-guard-profile.yaml',
      description: 'Built-in guarded coding workflow profile',
    },
  })
  configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId: null,
    name: 'worktree-default',
    spec: {
      provider: 'host',
      mode: 'worktree',
      filesystem: { worktree: 'readWrite' },
      network: { mode: 'host' },
      credentials: { expose: [] },
    },
  })
  return {
    models: MODEL_REGISTRY.length + 1,
    harnesses: BUILT_IN_HARNESSES.length,
    workflows: 1,
    sandboxProfiles: 1,
  }
}

function modelCatalogEntries(): Array<Pick<ConfigResource, 'name' | 'spec'>> {
  return [
    ...MODEL_REGISTRY.map((entry) => ({
      name: entry.id,
      spec: {
        provider: entry.provider,
        modelId: providerModelIdForEntry(entry),
        ...(entry.supportedEfforts == null ? {} : { supportedEfforts: entry.supportedEfforts }),
        scannerSource: entry.scannerKind,
        sourceUrl: entry.sourceUrl,
        lastVerifiedAt: entry.lastVerifiedAt,
        enabled: true,
      },
    })),
    copilotModel(),
  ]
}

function seedAgents(
  repos: ReturnType<typeof createSeedRepos>,
  providers: InitialFactoryAgentProvider[],
): SeededAgent[] {
  return providers.flatMap((provider) => agentSpecs(provider).map((spec) => {
    return { agent: repos.agents.create(agentSeed(spec)), roles: [...spec.roles] }
  }))
}

function agentSeed(spec: SeedAgentSpec): Omit<Agent, 'createdAt'> {
  return {
    id: createId<'AgentId'>(),
    name: spec.name,
    model: spec.providerModelId,
    harness: spec.harness as Agent['harness'],
    resourceRefs: {
      modelRef: spec.modelRef,
      harnessRef: spec.harness,
      workflowProfileRef: 'coding-guard',
      sandboxRef: 'worktree-default',
    },
    capabilities: spec.capabilities,
    effort: spec.effort,
    costTier: resolveModelEntry(spec.providerModelId)?.defaultCostTier ?? spec.costTier,
    spawnConfig: {},
  }
}

function agentSpecs(provider: InitialFactoryAgentProvider): SeedAgentSpec[] {
  if (provider === 'anthropic') {
    return [
      {
        name: 'claude-builder',
        modelRef: 'claude-sonnet-4-6',
        providerModelId: 'claude-sonnet-4-6',
        harness: 'claude-agent-sdk',
        capabilities: ['build', 'test', 'fix'] as Agent['capabilities'],
        effort: 'max' as const,
        roles: ['builder'] as Array<'builder' | 'reviewer'>,
        costTier: 70,
      },
      {
        name: 'claude-reviewer',
        modelRef: 'claude-opus-4-8',
        providerModelId: 'claude-opus-4-8',
        harness: 'claude-agent-sdk',
        capabilities: ['review', 'fix', 'build', 'test'] as Agent['capabilities'],
        effort: 'xhigh' as const,
        roles: ['reviewer'] as Array<'builder' | 'reviewer'>,
        costTier: 92,
      },
    ]
  }
  if (provider === 'copilot') {
    return [{
      name: 'copilot-builder',
      modelRef: 'github-copilot-gpt-5',
      providerModelId: 'github-copilot-gpt-5',
      harness: 'copilot-sdk',
      capabilities: ['build', 'test', 'fix'] as Agent['capabilities'],
      effort: 'medium' as const,
      roles: ['builder'] as Array<'builder' | 'reviewer'>,
      costTier: 60,
    }]
  }
  return [{
    name: 'codex-builder',
    modelRef: 'gpt-5.5',
    providerModelId: 'gpt-5.5',
    harness: 'codex-sdk',
    capabilities: ['build', 'test', 'fix'] as Agent['capabilities'],
    effort: 'medium' as const,
    roles: ['builder'] as Array<'builder' | 'reviewer'>,
    costTier: 95,
  }]
}

function copilotModel(): Pick<ConfigResource, 'name' | 'spec'> {
  return {
    name: 'github-copilot-gpt-5',
    spec: { provider: 'github-copilot', modelId: 'github-copilot-gpt-5', supportedEfforts: ['medium'] },
  }
}
