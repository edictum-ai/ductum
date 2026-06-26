import { accessSync, constants } from 'node:fs'
import { delimiter } from 'node:path'

import { findHarness, findModel } from './factory-settings-catalog-helpers.js'
import { parseFactorySecretRef } from './factory-secret-refs.js'
import { redactPublicOutput, redactPublicText, isSafeEnvReference } from './public-redaction.js'
import type { RepairReport } from './repair-types.js'
import type { Agent, ProjectAgent } from './types.js'
import type { FactorySecretMetadata, FactorySettingsCatalogs } from './factory-settings-types.js'

export type FactoryDoctorStatus = 'ready' | 'blocked' | 'deferred'
export type FactoryDoctorCheckKind = 'model_route' | 'auth' | 'endpoint' | 'harness_command' | 'spawn_env'

export interface FactoryDoctorCheck {
  kind: FactoryDoctorCheckKind
  status: FactoryDoctorStatus
  message: string
  refs?: string[]
}

export interface FactoryDoctorAgentReport {
  agentId: string
  agentName: string
  assignmentRoles: string[]
  providerId: string
  modelId: string
  providerModelId: string
  harnessId: string
  harnessType: string
  accountId: string | null
  status: FactoryDoctorStatus
  checks: FactoryDoctorCheck[]
}

export interface FactoryDoctorReport {
  status: FactoryDoctorStatus
  summary: { ready: number; blocked: number; deferred: number }
  agents: FactoryDoctorAgentReport[]
  liveSmoke: { enabled: boolean; status: 'skipped' | 'deferred'; reason: string }
  sharedReadiness?: RepairReport
}

export interface BuildFactoryDoctorInput {
  catalogs: FactorySettingsCatalogs
  agents: Agent[]
  assignments: ProjectAgent[]
  secrets?: FactorySecretMetadata[]
  env?: Record<string, string | undefined>
  commandExists?: (command: string) => boolean
  authProbe?: (input: { providerId: string; harnessType: string; command?: string }) => FactoryDoctorCheck | null
  liveSmoke?: boolean
}

export function buildFactoryDoctorReport(input: BuildFactoryDoctorInput): FactoryDoctorReport {
  const env = input.env ?? process.env
  const secrets = input.secrets ?? []
  const commandExists = input.commandExists ?? defaultCommandExists(env)
  const assignmentRoles = rolesByAgent(input.assignments)
  const assignedAgents = input.agents.filter((agent) => assignmentRoles.has(agent.id))
  const agents = assignedAgents.map((agent) => agentReport(agent, assignmentRoles.get(agent.id) ?? [], input, env, secrets, commandExists))
  const summary = {
    ready: agents.filter((agent) => agent.status === 'ready').length,
    blocked: agents.filter((agent) => agent.status === 'blocked').length,
    deferred: agents.filter((agent) => agent.status === 'deferred').length,
  }
  return redactPublicOutput({
    status: summary.blocked > 0 ? 'blocked' : summary.deferred > 0 ? 'deferred' : 'ready',
    summary,
    agents,
    liveSmoke: {
      enabled: input.liveSmoke === true,
      status: input.liveSmoke === true ? 'deferred' : 'skipped',
      reason: input.liveSmoke === true
        ? 'live smoke was requested but is deferred on this static API doctor; no token-spending request was sent'
        : 'live smoke is opt-in and was not requested; no token-spending request was sent',
    },
  } satisfies FactoryDoctorReport)
}

function agentReport(
  agent: Agent,
  roles: string[],
  input: BuildFactoryDoctorInput,
  env: Record<string, string | undefined>,
  secrets: FactorySecretMetadata[],
  commandExists: (command: string) => boolean,
): FactoryDoctorAgentReport {
  const refs = agent.resourceRefs ?? {}
  const model = findModel(input.catalogs.models, refs.modelRef, agent.model)
  const harness = findHarness(input.catalogs.harnesses, refs.harnessRef, agent.harness)
  const providerId = model?.providerId ?? agent.providerId ?? 'unknown'
  const providerModelId = model?.providerModelId ?? agent.model
  const harnessType = harness?.adapterType ?? agent.harness
  const harnessId = harness?.harnessId ?? refs.harnessRef ?? agent.harness
  const checks = [
    modelRouteCheck(agent, providerId, providerModelId, model, harnessType),
    authCheck(providerId, harnessType, harness?.command, env, input.authProbe),
    endpointCheck(providerId, providerModelId, harnessType, env, agent.spawnConfig.env ?? {}),
    harnessCommandCheck(harnessType, harness?.command, env, commandExists),
    spawnEnvCheck(agent, secrets, env),
  ]
  return {
    agentId: agent.id,
    agentName: agent.name,
    assignmentRoles: [...new Set(roles)].sort(),
    providerId,
    modelId: model?.modelId ?? refs.modelRef ?? agent.model,
    providerModelId,
    harnessId,
    harnessType,
    accountId: agent.accountId ?? null,
    status: aggregateStatus(checks),
    checks,
  }
}

function modelRouteCheck(agent: Agent, providerId: string, providerModelId: string, model: unknown, harnessType: string): FactoryDoctorCheck {
  if (model == null) return blocked('model_route', `Agent ${agent.name} modelRef/model does not resolve to a Factory Settings Model`, [agent.resourceRefs?.modelRef ?? agent.model])
  return ready('model_route', `route resolved: provider ${providerId}, provider model ${providerModelId}, harness adapter ${harnessType}`)
}

function authCheck(
  providerId: string,
  harnessType: string,
  command: string | undefined,
  env: Record<string, string | undefined>,
  authProbe: BuildFactoryDoctorInput['authProbe'],
): FactoryDoctorCheck {
  const names = authEnvNames(providerId)
  if (names == null) return deferred('auth', `auth detector for provider ${providerId} is deferred; dispatch is not blocked by this doctor gap`, [providerId])
  const present = names.filter((name) => envPresent(env[name]))
  if (present.length > 0) return ready('auth', `provider credential env present for ${providerId} (${present.join(', ')})`, present)
  const probed = authProbe?.({ providerId, harnessType, command })
  if (probed != null) return probed
  return blocked('auth', `missing provider credential env for ${providerId} (${names.join(' or ')})`, names)
}

function endpointCheck(
  providerId: string,
  providerModelId: string,
  harnessType: string,
  env: Record<string, string | undefined>,
  spawnEnv: Record<string, string>,
): FactoryDoctorCheck {
  const endpoint = endpointEnvName(providerId, harnessType)
  if (endpoint == null) return ready('endpoint', `provider ${providerId} uses SDK default endpoint for harness ${harnessType}`)
  const value = envValue(endpoint, env, spawnEnv)
  if (!envPresent(value)) return blocked('endpoint', `missing endpoint/base URL ${endpoint} for provider ${providerId}`, [endpoint])
  if (providerId === 'zai' && !/z\.ai/i.test(value ?? '')) {
    return blocked('endpoint', `GLM/Z.AI route for ${providerModelId} must use ${endpoint} pointing at Z.AI, not the default Anthropic/OpenAI endpoint`, [endpoint])
  }
  return ready('endpoint', `endpoint/base URL configured via ${endpoint}`, [endpoint])
}

function envValue(name: string, env: Record<string, string | undefined>, spawnEnv: Record<string, string>): string | undefined {
  const local = spawnEnv[name]
  if (local == null) return env[name]
  if (isSafeEnvReference(local)) {
    const ref = local.trim().slice(2, -1)
    return env[ref]
  }
  return local
}

function harnessCommandCheck(
  harnessType: string,
  command: string | undefined,
  env: Record<string, string | undefined>,
  commandExists: (command: string) => boolean,
): FactoryDoctorCheck {
  const executable = firstCommandToken(effectiveHarnessCommand(harnessType, command, env))
  if (executable == null) return blocked('harness_command', 'missing harness command in Factory Settings Harness')
  if (!commandExists(executable)) return blocked('harness_command', `harness command not found on PATH: ${executable}`, [executable])
  return ready('harness_command', `harness command is available: ${executable}`, [executable])
}

function effectiveHarnessCommand(
  harnessType: string,
  command: string | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  const codexCommand = env.DUCTUM_CODEX_COMMAND?.trim()
  if ((harnessType === 'codex-sdk' || harnessType === 'codex-app-server') && codexCommand != null && codexCommand !== '') {
    return codexCommand
  }
  return command
}

function spawnEnvCheck(agent: Agent, secrets: FactorySecretMetadata[], env: Record<string, string | undefined>): FactoryDoctorCheck {
  const missing = missingSpawnRefs(agent.spawnConfig.env ?? {}, secrets, env)
  if (missing.length > 0) return blocked('spawn_env', `missing spawn env references: ${missing.join(', ')}`, missing)
  return ready('spawn_env', 'spawn env references are present; literal values were not inspected or printed')
}

function missingSpawnRefs(spawnEnv: Record<string, string>, secrets: FactorySecretMetadata[], env: Record<string, string | undefined>): string[] {
  const secretIds = new Set(secrets.filter((secret) => secret.status === 'configured').map((secret) => secret.id))
  const missing: string[] = []
  for (const [key, value] of Object.entries(spawnEnv)) {
    if (isSafeEnvReference(value)) {
      const name = value.trim().slice(2, -1)
      if (!envPresent(env[name])) missing.push(`${key}->${name}`)
      continue
    }
    const secretId = parseFactorySecretRef(value)
    if (secretId != null && !secretIds.has(secretId)) missing.push(`${key}->secret:${secretId}`)
  }
  return missing.sort()
}

function authEnvNames(providerId: string): string[] | null {
  if (providerId === 'anthropic') return ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
  if (providerId === 'openai') return ['OPENAI_API_KEY']
  if (providerId === 'zai') return ['ZAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN']
  if (providerId === 'github-copilot') return ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']
  return null
}

function endpointEnvName(providerId: string, harnessType: string): string | null {
  if (providerId === 'zai' && harnessType === 'claude-agent-sdk') return 'ANTHROPIC_BASE_URL'
  if (providerId === 'zai') return 'OPENAI_BASE_URL'
  return null
}

function rolesByAgent(assignments: ProjectAgent[]): Map<string, string[]> {
  const roles = new Map<string, string[]>()
  for (const assignment of assignments) roles.set(assignment.agentId, [...(roles.get(assignment.agentId) ?? []), assignment.role])
  return roles
}

function aggregateStatus(checks: FactoryDoctorCheck[]): FactoryDoctorStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'deferred')) return 'deferred'
  return 'ready'
}

function ready(kind: FactoryDoctorCheckKind, message: string, refs?: string[]): FactoryDoctorCheck {
  return { kind, status: 'ready', message: redactPublicText(message), ...(refs == null ? {} : { refs }) }
}

function blocked(kind: FactoryDoctorCheckKind, message: string, refs?: string[]): FactoryDoctorCheck {
  return { kind, status: 'blocked', message: redactPublicText(message), ...(refs == null ? {} : { refs }) }
}

function deferred(kind: FactoryDoctorCheckKind, message: string, refs?: string[]): FactoryDoctorCheck {
  return { kind, status: 'deferred', message: redactPublicText(message), ...(refs == null ? {} : { refs }) }
}

function envPresent(value: string | undefined): boolean {
  return value != null && value.trim() !== ''
}

function firstCommandToken(command: string | undefined): string | null {
  const trimmed = command?.trim()
  if (trimmed == null || trimmed === '') return null
  return trimmed.split(/\s+/)[0] ?? null
}

function defaultCommandExists(env: Record<string, string | undefined>): (command: string) => boolean {
  return (command) => {
    if (command.includes('/')) return isExecutable(command)
    return (env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && isExecutable(`${dir}/${command}`))
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
