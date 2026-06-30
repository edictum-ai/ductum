import { join, resolve } from 'node:path'
import {
  initDb,
  SqliteAgentRepo,
  SqliteFactoryRepo,
  SqliteFactoryRuntimeSettingsRepo,
  SqliteProjectRepo,
  SqliteRepositoryRepo,
} from '@ductum/core'

export interface ServeConfigData {
  apiBindHost: string | null
  apiPort: number | null
  dashboardUrl: string | null
  dispatcherEnabled: boolean | null
  agentsConfig: Record<string, { harness: string }>
  repoPathMap: Record<string, string>
  workflowProfiles: string
  heartbeatTimeoutSeconds: number
  heartbeatIntervalMs: number
  mergeConfig: Record<string, unknown>
  costBudget: Record<string, unknown>
  worktreeConfig: Record<string, unknown>
  publicBaseUrl: string
  observerMode: boolean
}

export function loadPersistedServeConfig(dbPath: string, factoryDir: string): ServeConfigData {
  const db = initDb(dbPath)
  try {
    const factory = new SqliteFactoryRepo(db).get()
    if (factory == null) throw new Error(`${dbPath} has no Factory record`)
    const projects = new SqliteProjectRepo(db).list(factory.id)
    const repositories = new SqliteRepositoryRepo(db)
    const agents = new SqliteAgentRepo(db).list()
    const runtime = new SqliteFactoryRuntimeSettingsRepo(db).get(factory.id)
    const repoPathMap = buildRepoPathMap(factoryDir, projects, repositories)
    const costBudget = asRecord((factory.config as unknown as Record<string, unknown>).costBudget)
    return {
      apiBindHost: runtime?.apiBindHost ?? null,
      apiPort: runtime?.apiPort ?? null,
      dashboardUrl: runtime?.dashboardUrl ?? null,
      dispatcherEnabled: runtime?.dispatcherEnabled ?? null,
      agentsConfig: Object.fromEntries(agents.map((agent) => [agent.name, { harness: agent.harness }])),
      repoPathMap,
      workflowProfiles: '',
      heartbeatTimeoutSeconds: factory.config.heartbeatTimeoutSeconds,
      heartbeatIntervalMs: (runtime?.dispatcherHeartbeatIntervalSeconds ?? 30) * 1000,
      mergeConfig: {
        push: false,
        base: 'main',
        strategy: 'merge',
        pushTags: false,
        approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      },
      costBudget,
      worktreeConfig: {
        enabled: runtime?.worktreeEnabled ?? true,
        basePath: runtime?.worktreeBasePath ?? join(factoryDir, '.ductum', 'worktrees'),
      },
      publicBaseUrl: runtime?.publicApiUrl ?? '',
      observerMode: false,
    }
  } finally {
    db.close()
  }
}

function buildRepoPathMap(
  factoryDir: string,
  projects: ReturnType<SqliteProjectRepo['list']>,
  repositories: SqliteRepositoryRepo,
): Record<string, string> {
  const map: Record<string, string> = { '.': factoryDir }
  for (const project of projects) {
    for (const repoRef of project.repos) {
      if (repoRef === '.') map['.'] = factoryDir
      else if (map[repoRef] == null) map[repoRef] = resolve(factoryDir, repoRef)
    }
    for (const repository of repositories.list(project.id)) {
      const localPath = repository.spec.localPath
      if (localPath == null) continue
      const resolved = resolve(factoryDir, localPath)
      map[repository.name] = resolved
      map[localPath] = resolved
    }
  }
  return map
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
