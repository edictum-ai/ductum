import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export interface ApiRuntimeLayout {
  apiEntry: string
  dashboardDist: string
  workflowsDir: string
  sampleSpecsDir: string
  harnessModule: string
  mcpModule: string
  cwd: string
}

export interface ApiProcessArgsInput {
  apiEntry: string
  host: string
  port: number
  dbPath: string
  dispatch: boolean
}

export interface ApiEnvInput {
  env: Record<string, string | undefined>
  host: string
  port?: number
  operatorToken: string
  factoryDataDir?: string
  dashboardDist: string
  workflowsDir: string
  sampleSpecsDir: string
  harnessModule: string
  mcpModule: string
  repoPathMap?: Record<string, string>
  agentsConfig?: Record<string, { harness: string }>
  worktreeConfig?: Record<string, unknown>
  heartbeatTimeoutSeconds?: number
  heartbeatIntervalMs?: number
  mergeConfig?: Record<string, unknown>
  costBudget?: Record<string, unknown>
  publicBaseUrl?: string
  dashboardUrl?: string
  workflowProfiles?: string
  observerMode?: boolean
}

export function resolveApiRuntimeLayout(input: {
  repoRoot?: string
  startUrl?: string
  requireApiEntry?: boolean
} = {}): ApiRuntimeLayout {
  const candidates = [
    ...(input.repoRoot == null ? [] : candidatesFromRepoRoot(resolve(input.repoRoot))),
    ...candidatesFromPackageRoots(findPackageRoots(input.startUrl ?? import.meta.url)),
  ]
  const found = candidates.find((candidate) => existsSync(candidate.apiEntry))
  if (found != null) return found
  if (input.requireApiEntry === false && candidates[0] != null) return candidates[0]
  const checked = candidates.map((candidate) => candidate.apiEntry).join(', ')
  throw new Error(`Cannot find Ductum API runtime. Checked: ${checked}`)
}

export function buildApiProcessArgs(input: ApiProcessArgsInput): string[] {
  return [
    input.apiEntry,
    '--host',
    input.host,
    '--port',
    String(input.port),
    '--db',
    input.dbPath,
    ...(input.dispatch ? ['--dispatch'] : []),
  ]
}

export function buildApiEnv(input: ApiEnvInput): Record<string, string> {
  return compactEnv({
    PATH: input.env.PATH,
    HOME: input.env.HOME,
    TERM: input.env.TERM,
    NODE_ENV: input.env.NODE_ENV,
    ...authEnv(input.env),
    DUCTUM_HOST: input.host,
    ...(input.port == null ? {} : { DUCTUM_PORT: String(input.port) }),
    DUCTUM_OPERATOR_TOKEN: input.operatorToken,
    ...(input.factoryDataDir == null ? {} : { DUCTUM_FACTORY_DATA_DIR: input.factoryDataDir }),
    DUCTUM_DASHBOARD_DIST: input.dashboardDist,
    DUCTUM_WORKFLOWS_DIR: input.workflowsDir,
    DUCTUM_SAMPLE_SPECS_DIR: input.sampleSpecsDir,
    DUCTUM_HARNESS_MODULE_PATH: toImportSpecifier(input.harnessModule),
    DUCTUM_MCP_MODULE_PATH: toImportSpecifier(input.mcpModule),
    ...(input.repoPathMap == null ? {} : { DUCTUM_REPO_PATH_MAP: JSON.stringify(input.repoPathMap) }),
    ...(input.agentsConfig == null ? {} : { DUCTUM_AGENTS_CONFIG: JSON.stringify(input.agentsConfig) }),
    ...(input.worktreeConfig == null ? {} : { DUCTUM_WORKTREE_CONFIG: JSON.stringify(input.worktreeConfig) }),
    ...(input.heartbeatTimeoutSeconds == null ? {} : {
      DUCTUM_HEARTBEAT_TIMEOUT_SECONDS: String(input.heartbeatTimeoutSeconds),
    }),
    ...(input.heartbeatIntervalMs == null ? {} : {
      DUCTUM_HEARTBEAT_INTERVAL_MS: String(input.heartbeatIntervalMs),
    }),
    ...(input.mergeConfig == null ? {} : { DUCTUM_MERGE_CONFIG: JSON.stringify(input.mergeConfig) }),
    ...(input.costBudget == null ? {} : { DUCTUM_COST_BUDGET: JSON.stringify(input.costBudget) }),
    ...(input.publicBaseUrl == null || input.publicBaseUrl === '' ? {} : {
      DUCTUM_PUBLIC_BASE_URL: input.publicBaseUrl,
    }),
    ...(input.dashboardUrl == null || input.dashboardUrl === '' ? {} : {
      DUCTUM_DASHBOARD_URL: input.dashboardUrl,
    }),
    ...(input.workflowProfiles == null || input.workflowProfiles === '' ? {} : {
      DUCTUM_WORKFLOW_PROFILES: input.workflowProfiles,
    }),
    ...(input.observerMode === true ? { DUCTUM_OBSERVER_MODE: 'true' } : {}),
    ...(input.env.DUCTUM_MOCK_AGENT_CALLS === '1' ? { DUCTUM_MOCK_AGENT_CALLS: '1' } : {}),
    ...(input.env.DUCTUM_MOCK_AGENT_DELAY_MS == null || input.env.DUCTUM_MOCK_AGENT_DELAY_MS.trim() === ''
      ? {}
      : { DUCTUM_MOCK_AGENT_DELAY_MS: input.env.DUCTUM_MOCK_AGENT_DELAY_MS }),
  })
}

function authEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ANTHROPIC_OAUTH_TOKEN: env.ANTHROPIC_OAUTH_TOKEN,
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL,
    ZAI_API_KEY: env.ZAI_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    DUCTUM_CODEX_COMMAND: env.DUCTUM_CODEX_COMMAND,
  }
}

function findPackageRoots(startUrl: string): string[] {
  let current = dirname(fileURLToPath(startUrl))
  const roots: string[] = []
  while (true) {
    if (existsSync(join(current, 'package.json'))) roots.push(current)
    const next = dirname(current)
    if (next === current) return roots
    current = next
  }
}

function candidatesFromPackageRoots(roots: string[]): ApiRuntimeLayout[] {
  return roots.flatMap((root) => {
    const published = candidate({
      cwd: root,
      apiEntry: join(root, 'dist', 'api', 'index.js'),
      dashboardDist: join(root, 'dist', 'dashboard'),
      workflowsDir: join(root, 'dist', 'workflows'),
      sampleSpecsDir: join(root, 'assets', 'specs', 'examples'),
      harnessModule: join(root, 'dist', 'harness', 'index.js'),
      mcpModule: join(root, 'dist', 'mcp', 'index.js'),
    })
    const workspace = candidateFromWorkspaceRoot(resolve(root, '../..'))
    const sibling = candidate({
      cwd: resolve(root, '..'),
      apiEntry: join(root, '..', 'api', 'dist', 'index.js'),
      dashboardDist: join(root, '..', 'dashboard', 'dist'),
      workflowsDir: join(root, '..', '..', 'workflows'),
      sampleSpecsDir: join(root, '..', '..', 'packages', 'ductum', 'assets', 'specs', 'examples'),
      harnessModule: join(root, '..', 'harness', 'dist', 'index.js'),
      mcpModule: join(root, '..', 'mcp', 'dist', 'index.js'),
    })
    return readPackageName(root) === '@ductum/cli'
      ? [workspace, sibling, published]
      : [published, workspace, sibling]
  })
}

function candidatesFromRepoRoot(root: string): ApiRuntimeLayout[] {
  return [
    candidateFromWorkspaceRoot(root),
    candidate({
      cwd: root,
      apiEntry: join(root, 'dist', 'api', 'index.js'),
      dashboardDist: join(root, 'dist', 'dashboard'),
      workflowsDir: join(root, 'dist', 'workflows'),
      sampleSpecsDir: join(root, 'assets', 'specs', 'examples'),
      harnessModule: join(root, 'dist', 'harness', 'index.js'),
      mcpModule: join(root, 'dist', 'mcp', 'index.js'),
    }),
  ]
}

function candidateFromWorkspaceRoot(root: string): ApiRuntimeLayout {
  return candidate({
    cwd: root,
    apiEntry: join(root, 'packages', 'api', 'dist', 'index.js'),
    dashboardDist: join(root, 'packages', 'dashboard', 'dist'),
    workflowsDir: join(root, 'workflows'),
    sampleSpecsDir: join(root, 'packages', 'ductum', 'assets', 'specs', 'examples'),
    harnessModule: join(root, 'packages', 'harness', 'dist', 'index.js'),
    mcpModule: join(root, 'packages', 'mcp', 'dist', 'index.js'),
  })
}

function candidate(input: ApiRuntimeLayout): ApiRuntimeLayout {
  return {
    apiEntry: resolve(input.apiEntry),
    dashboardDist: resolve(input.dashboardDist),
    workflowsDir: resolve(input.workflowsDir),
    sampleSpecsDir: resolve(input.sampleSpecsDir),
    harnessModule: resolve(input.harnessModule),
    mcpModule: resolve(input.mcpModule),
    cwd: resolve(input.cwd),
  }
}

function compactEnv(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== ''),
  )
}

function toImportSpecifier(path: string): string {
  return pathToFileURL(path).href
}

function readPackageName(root: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : null
  } catch {
    return null
  }
}
