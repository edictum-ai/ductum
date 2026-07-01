import { buildFactoryDoctorReport, buildFactorySettingsCatalogs, type Agent } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { resolveCatalogEntry } from './model-catalog.js'

const REQUIRED_MATRIX_MODELS = ['glm-5.2', 'gpt-5.5', 'claude-opus-4-8', 'claude-sonnet-5']

export function rejectOmittedRequiredMatrixModels(
  context: ApiContext,
  projectId: string,
  builderIds: Set<string>,
  builders: Agent[],
  doctorBlockedModels: string[],
): void {
  const configured = context.repos.agents.list().filter((agent) => builderIds.has(agent.id))
  const configuredModels = new Set(configured.map(modelKey))
  if (!REQUIRED_MATRIX_MODELS.every((model) => configuredModels.has(model))) return
  const selectedModels = new Set(builders.map(modelKey))
  const blockedModels = doctorProvenBlockedModels(context, projectId, configured, doctorBlockedModels)
  const missing = REQUIRED_MATRIX_MODELS.filter((model) => !selectedModels.has(model) && !blockedModels.has(model))
  if (missing.length > 0) {
    throw new ValidationError(`Bakeoff matrix omits configured routable model(s): ${missing.join(', ')}; run doctor and record an explicit block before omitting them`)
  }
}

export function modelKey(agent: Agent): string {
  return resolveCatalogEntry(agent.model)?.id ?? agent.model.trim().toLowerCase()
}

function doctorProvenBlockedModels(
  context: ApiContext,
  projectId: string,
  configuredBuilders: Agent[],
  requestedBlocks: string[],
): Set<string> {
  if (requestedBlocks.length === 0) return new Set()
  const requested = new Set(requestedBlocks.map((model) => model.trim().toLowerCase()).filter((model) => model !== ''))
  if (requested.size === 0) return new Set()
  const report = buildFactoryDoctorReport({
    catalogs: buildFactorySettingsCatalogs({
      factory: context.repos.factory.get(),
      configResources: context.repos.configResources.list(),
      agents: context.repos.agents.list(),
      costBudget: context.costBudget,
    }),
    agents: context.repos.agents.list(),
    assignments: context.repos.projectAgents.list(projectId as never),
    secrets: context.repos.secrets.list(),
    env: process.env,
  })
  const configuredById = new Map(configuredBuilders.map((agent) => [agent.id, modelKey(agent)]))
  return new Set(report.agents
    .filter((agent) => agent.status === 'blocked')
    .map((agent) => configuredById.get(agent.agentId as Agent['id']) ?? null)
    .filter((model): model is string => model != null && requested.has(model)))
}
