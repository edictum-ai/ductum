import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import {
  buildRepairReport,
  buildTaskPrerequisiteIssues,
  type Agent,
  type ConfigResource,
  type RepairCheckStatus,
  type RepairHostChecks,
  type RepairReport,
  type Task,
  providerForAgent,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { buildExecutionIntegrityReport } from './execution-integrity.js'
import { probeLocalAppReadiness, unprobedLocalAppStatus } from './local-app-readiness.js'
import { buildOperatorBrief } from './operator-brief.js'
import { buildApiFactorySettings } from './factory-settings.js'

export async function buildApiRepairReport(context: ApiContext): Promise<RepairReport> {
  return buildRepairReport(await coreRepairInput(context, { probeLocalApp: true }))
}

export function buildApiTaskPrerequisiteIssues(context: ApiContext, task: Task, agent: Agent) {
  return buildTaskPrerequisiteIssues({ ...coreRepairInputSync(context), task, agent })
}

async function coreRepairInput(context: ApiContext, options: { probeLocalApp: boolean }) {
  const input = coreRepairInputSync(context)
  return {
    ...input,
    host: mergeHostChecks({
      ...(input.host ?? {}),
      localApp: await localAppCheck(context, options.probeLocalApp),
    }, context.repairChecks),
  }
}

function coreRepairInputSync(context: ApiContext) {
  const factory = context.repos.factory.get()
  const projects = factory == null ? [] : context.repos.projects.list(factory.id)
  const repositoriesByProjectId = new Map(projects.map((project) => [
    project.id,
    context.repos.repositories.list(project.id),
  ] as const))
  const specs = projects.flatMap((project) => context.repos.specs.list(project.id))
  const tasks = context.repos.tasks.listBySpecIds(specs.map((spec) => spec.id))
  const agents = context.repos.agents.list()
  const configResources = context.repos.configResources.list()
  const requirements = repairRequirements(context, projects, repositoriesByProjectId)
  const brief = buildOperatorBrief(context, { now: context.now() })
  return {
    generatedAt: context.now().toISOString(),
    projects,
    repositoriesByProjectId,
    projectAgents: projects.flatMap((project) => context.repos.projectAgents.list(project.id)),
    agents,
    configResources,
    specs,
    tasks,
    dispatchSkips: context.repos.taskDispatchSkips.list(),
    dispatcher: { ...brief.dispatcher, adapters: context.getDispatcherStatus?.().adapters ?? [] },
    queue: brief.queue,
    telegram: brief.telegram,
    execution: buildExecutionIntegrityReport(context),
    host: mergeHostChecks(defaultHostChecks(context, agents, configResources, repositoriesByProjectId, requirements), context.repairChecks),
    requirements,
  }
}

function repairRequirements(
  context: ApiContext,
  projects: ReturnType<ApiContext['repos']['projects']['list']>,
  repos: ReadonlyMap<string, ReturnType<ApiContext['repos']['repositories']['list']>>,
) {
  const remoteProjectIds = new Set<string>()
  const githubProjectIds = new Set<string>()
  for (const project of projects) {
    const remoteRequired = context.merge.push === true || project.config.externalReviewRequired === true
    if (!remoteRequired) continue
    remoteProjectIds.add(project.id)
    if ((repos.get(project.id) ?? []).some((repo) => repo.readiness.github.state === 'configured')) {
      githubProjectIds.add(project.id)
    } else if (project.config.externalReviewRequired === true) {
      githubProjectIds.add(project.id)
    }
  }
  return {
    remoteProjectIds,
    githubProjectIds,
    adapterNames: new Set(context.getDispatcherStatus?.().adapters ?? []),
  }
}

function defaultHostChecks(
  context: ApiContext,
  agents: Agent[],
  configResources: ConfigResource[],
  repos: ReadonlyMap<string, ReturnType<ApiContext['repos']['repositories']['list']>>,
  requirements: ReturnType<typeof repairRequirements>,
): RepairHostChecks {
  const git = commandCheck('git', ['--version'], 'Git is installed')
  return {
    git,
    github: requirements.githubProjectIds.size > 0
      ? commandCheck('gh', ['auth', 'status', '--hostname', 'github.com'], 'GitHub CLI auth is active')
      : { state: 'not_applicable', label: 'No GitHub workflow selected' },
    providerAuth: providerAuthChecks(agents, configResources),
    factoryDataDir: writableDirCheck(factoryDataDir(context)),
    localApp: unprobedLocalAppStatus(context.runtime, process.env),
    repositories: Object.fromEntries([...repos.values()].flat().map((repo) => [
      repo.id,
      repo.spec.localPath == null ? {} : { localGit: localGitCheck(repo.spec.localPath, git) },
    ])),
    workflows: workflowChecks(context),
  }
}

async function localAppCheck(context: ApiContext, probeLocalApp: boolean): Promise<RepairCheckStatus> {
  if (!probeLocalApp) return unprobedLocalAppStatus(context.runtime, process.env)
  if (context.repairChecks?.localApp != null) return context.repairChecks.localApp
  if (context.probeLocalAppHealth != null) return context.probeLocalAppHealth()
  return probeLocalAppReadiness({ runtime: context.runtime, env: process.env })
}

function providerAuthChecks(agents: Agent[], configResources: ConfigResource[]): Record<string, RepairCheckStatus> {
  const providers = new Set(agents.map((agent) => providerForAgent(agent, configResources)).filter((provider): provider is string => provider != null))
  return Object.fromEntries([...providers].map((provider) => [provider, providerAuthCheck(provider)]))
}

function providerAuthCheck(provider: string): RepairCheckStatus {
  if (provider === 'openai') {
    if (hasEnv('OPENAI_API_KEY')) return ready('OpenAI credential source detected')
    const codex = commandCheck('codex', ['login', 'status'], 'Codex login is active')
    return codex.state === 'ready' ? codex : missing('OpenAI auth was not detected')
  }
  if (provider === 'anthropic') {
    return hasAnyEnv(['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'])
      || hasClaudeCredentialSource()
      ? ready('Anthropic credential source detected')
      : missing('Anthropic auth was not detected')
  }
  if (provider === 'zai') return hasAnyEnv(['ZAI_API_KEY', 'OPENROUTER_API_KEY'])
    ? ready('Z.AI credential source detected')
    : missing('Z.AI auth was not detected')
  if (provider === 'github-copilot') {
    if (hasAnyEnv(['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'])) return ready('GitHub Copilot credential source detected')
    const gh = commandCheck('gh', ['auth', 'status', '--hostname', 'github.com'], 'GitHub CLI auth is active for Copilot')
    if (gh.state === 'ready') return gh
    return hasGhHostsFile() ? ready('GitHub CLI hosts file is present for Copilot') : missing('GitHub Copilot auth was not detected')
  }
  return { state: 'unknown', label: provider, detail: `No auth detector exists for provider ${provider}` }
}

function localGitCheck(path: string, git: RepairCheckStatus): RepairCheckStatus {
  if (git.state !== 'ready') return { state: 'not_checked', label: path, detail: 'Git was not available, so repository checkout was not checked.' }
  return commandCheck('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], path)
}

function workflowChecks(context: ApiContext): Record<string, RepairCheckStatus> {
  return Object.fromEntries(buildApiFactorySettings(context).workflows.flatMap((workflow) =>
    workflow.validation?.valid === false
      ? [[workflow.id, { state: 'missing' as const, label: workflow.path, detail: workflow.validation.error ?? 'Workflow validation failed' }]]
      : [],
  ))
}

function writableDirCheck(path: string): RepairCheckStatus {
  try {
    accessSync(path, constants.W_OK)
    return ready(path)
  } catch {
    return { state: 'missing', label: path, detail: `Factory data directory is not writable: ${path}` }
  }
}

function commandCheck(command: string, args: string[], okLabel: string): RepairCheckStatus {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 1500 })
    return ready(okLabel)
  } catch {
    return missing(`${command} ${args.join(' ')} failed`)
  }
}

function mergeHostChecks(base: RepairHostChecks, override: Partial<RepairHostChecks> | undefined): RepairHostChecks {
  if (override == null) return base
  return {
    ...base,
    ...override,
    providerAuth: { ...(base.providerAuth ?? {}), ...(override.providerAuth ?? {}) },
    repositories: { ...(base.repositories ?? {}), ...(override.repositories ?? {}) },
    workflows: { ...(base.workflows ?? {}), ...(override.workflows ?? {}) },
  }
}

function factoryDataDir(context: ApiContext): string {
  return context.factoryDataDir ?? process.cwd()
}

function hasEnv(key: string): boolean {
  const value = process.env[key]
  return value != null && value.trim() !== ''
}

function hasAnyEnv(keys: string[]): boolean {
  return keys.some(hasEnv)
}

function hasClaudeCredentialSource(): boolean {
  const paths = [resolve(homedir(), '.claude', '.credentials.json')]
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (configDir != null && configDir !== '') paths.push(resolve(configDir, 'credentials.json'))
  return [...new Set(paths)].some(hasClaudeCredentialFile)
}

function hasGhHostsFile(): boolean {
  const home = process.env.HOME?.trim() || homedir()
  return existsSync(resolve(home, '.config', 'gh', 'hosts.yml'))
}

function hasClaudeCredentialFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    return hasCredentialValue(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return false
  }
}

function hasCredentialValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const key of ['accessToken', 'access_token', 'refreshToken', 'refresh_token']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return true
  }
  return Object.values(record).some(hasCredentialValue)
}

function ready(label: string): RepairCheckStatus {
  return { state: 'ready', label }
}

function missing(detail: string): RepairCheckStatus {
  return { state: 'missing', label: '(missing)', detail }
}
