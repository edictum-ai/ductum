import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import {
  providerForAgent,
  parseFactorySecretRef,
  isSafeEnvReference,
  type Agent,
  type ConfigResource,
  type FactorySecretMetadata,
  type HarnessSpec,
  type RepairCheckStatus,
  type RepairHostChecks,
} from '@ductum/core'

type HarnessConfigResource = ConfigResource & { kind: 'Harness'; spec: HarnessSpec }

export function providerAuthChecks(
  agents: Agent[],
  configResources: ConfigResource[],
  secrets: FactorySecretMetadata[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Pick<RepairHostChecks, 'providerAuth' | 'providerAuthByAgent'> {
  const providers = new Set(
    agents.map((agent) => providerForAgent(agent, configResources)).filter((provider): provider is string => provider != null),
  )
  const providerAuth = Object.fromEntries(
    [...providers].map((provider) => [provider, providerAuthCheck(provider, env)]),
  )
  const providerAuthByAgent = providerAuthByAgentChecks(agents, configResources, secrets, env)
  return Object.keys(providerAuthByAgent).length === 0
    ? { providerAuth }
    : { providerAuth, providerAuthByAgent }
}

export function effectiveCodexCommand(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DUCTUM_CODEX_COMMAND?.trim()
  return configured == null || configured === '' ? 'codex' : configured
}

export function effectiveHarnessAuthCommand(
  harnessType: string,
  command: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isCodexHarnessType(harnessType)) {
    const overridden = env.DUCTUM_CODEX_COMMAND?.trim()
    if (overridden != null && overridden !== '') return overridden
    const configured = command?.trim()
    return configured == null || configured === '' ? 'codex' : configured
  }
  const configured = command?.trim()
  return configured == null || configured === '' ? undefined : configured
}

export function probeCodexCommandAuth(command: string): RepairCheckStatus {
  return commandCheck(command, ['login', 'status'], 'Codex login is active')
}

export function probeGithubCopilotLocalAuth(): RepairCheckStatus {
  const gh = commandCheck('gh', ['auth', 'status', '--hostname', 'github.com'], 'GitHub CLI auth is active for Copilot')
  if (gh.state === 'ready') return gh
  return hasGhHostsFile() ? ready('GitHub CLI hosts file is present for Copilot') : missing('GitHub Copilot auth was not detected')
}

function providerAuthCheck(provider: string, env: NodeJS.ProcessEnv): RepairCheckStatus {
  if (provider === 'openai') {
    if (hasEnv('OPENAI_API_KEY', env)) return ready('OpenAI credential source detected')
    const codex = probeCodexCommandAuth(effectiveCodexCommand(env))
    if (codex.state === 'ready') return codex
    return missing('OpenAI auth was not detected')
  }
  if (provider === 'anthropic') {
    return hasAnyEnv(['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'], env)
      || hasClaudeCredentialSource()
      ? ready('Anthropic credential source detected')
      : missing('Anthropic auth was not detected')
  }
  if (provider === 'zai') return hasAnyEnv(['ZAI_API_KEY', 'OPENROUTER_API_KEY'], env)
    ? ready('Z.AI credential source detected')
    : missing('Z.AI auth was not detected')
  if (provider === 'github-copilot') {
    if (hasAnyEnv(['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'], env)) return ready('GitHub Copilot credential source detected')
    return probeGithubCopilotLocalAuth()
  }
  return { state: 'unknown', label: provider, detail: `No auth detector exists for provider ${provider}` }
}

function providerAuthByAgentChecks(
  agents: Agent[],
  configResources: ConfigResource[],
  secrets: FactorySecretMetadata[],
  env: NodeJS.ProcessEnv,
): Record<string, RepairCheckStatus> {
  const checks: Record<string, RepairCheckStatus> = {}
  for (const agent of agents) {
    const route = resolveProviderAuthRoute(agent, configResources)
    if (route.providerId == null) continue
    if (hasScopedProviderCredential(agent, route.providerId, secrets, env)) {
      checks[agent.id] = ready(`${providerLabel(route.providerId)} agent-scoped credential source detected`)
      continue
    }
    if (route.providerId !== 'openai') continue
    if (hasEnv('OPENAI_API_KEY', env) || !isCodexHarnessType(route.harnessType)) continue
    checks[agent.id] = probeCodexCommandAuth(route.command)
  }
  return checks
}

export function resolveProviderAuthRoute(
  agent: Agent,
  configResources: ConfigResource[],
  env: NodeJS.ProcessEnv = process.env,
): { providerId: string | null; harnessType: string; command: string } {
  const harness = resolveHarnessResource(agent, configResources)
  const harnessType = typeof harness?.spec.type === 'string' && harness.spec.type.trim() !== ''
    ? harness.spec.type.trim()
    : agent.harness
  return {
    providerId: providerForAgent(agent, configResources),
    harnessType,
    command: effectiveHarnessAuthCommand(harnessType, harness?.spec.command, env) ?? effectiveCodexCommand(env),
  }
}

function isCodexHarnessType(harnessType: string): boolean {
  return harnessType === 'codex-sdk' || harnessType === 'codex-app-server'
}

function resolveHarnessResource(agent: Agent, configResources: ConfigResource[]): HarnessConfigResource | null {
  const resources = configResources.filter(isHarnessResource)
  const ref = agent.resourceRefs?.harnessRef?.trim()
  if (ref != null && ref !== '') {
    return resources.find((resource) => resource.id === ref)
      ?? resources.find((resource) => resource.name === ref && resource.projectId == null)
      ?? null
  }
  return resources.find((resource) => resource.name === agent.harness && resource.projectId == null) ?? null
}

function isHarnessResource(resource: ConfigResource): resource is HarnessConfigResource {
  return resource.kind === 'Harness'
}

function commandCheck(command: string, args: string[], okLabel: string): RepairCheckStatus {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 1500 })
    return ready(okLabel)
  } catch {
    return missing(`${command} ${args.join(' ')} failed`)
  }
}

function hasScopedProviderCredential(
  agent: Agent,
  provider: string,
  secrets: FactorySecretMetadata[],
  env: NodeJS.ProcessEnv,
): boolean {
  return providerAuthEnvNames(provider).some((name) => spawnCredentialPresent(name, agent.spawnConfig.env ?? {}, secrets, env))
}

function spawnCredentialPresent(
  name: string,
  spawnEnv: Record<string, string>,
  secrets: FactorySecretMetadata[],
  env: NodeJS.ProcessEnv,
): boolean {
  const value = spawnEnv[name]
  if (value == null || value.trim() === '') return false
  if (isSafeEnvReference(value)) {
    const ref = value.trim().slice(2, -1)
    return hasValue(env[ref])
  }
  const secretId = parseFactorySecretRef(value)
  return secretId != null && secrets.some((secret) => secret.id === secretId && secret.status === 'configured')
}

function providerAuthEnvNames(provider: string): string[] {
  if (provider === 'openai') return ['OPENAI_API_KEY']
  if (provider === 'anthropic') return ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
  if (provider === 'zai') return ['ZAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENROUTER_API_KEY']
  if (provider === 'github-copilot') return ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']
  return []
}

function providerLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'zai') return 'Z.AI'
  if (provider === 'github-copilot') return 'GitHub Copilot'
  return provider
}

function hasEnv(key: string, env: NodeJS.ProcessEnv): boolean {
  return hasValue(env[key])
}

function hasValue(value: string | undefined): boolean {
  return value != null && value.trim() !== ''
}

function hasAnyEnv(keys: string[], env: NodeJS.ProcessEnv): boolean {
  return keys.some((key) => hasEnv(key, env))
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
