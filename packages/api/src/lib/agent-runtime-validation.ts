import {
  assertFactorySettingsAgentCompatible,
  assertSupportedSandboxProfileSpec,
  resolveAgentRuntimeDetails,
  resolveAgentSandboxProfileDetails,
  resolveAgentWorkflowProfile,
  type Agent,
  type AgentEffort,
  type ConfigResource,
  type ConfigResourceRepo,
  type ModelSpec,
  type ProjectId,
} from '@ductum/core'

import { ValidationError } from './errors.js'
import {
  defaultCostTierFor,
  HARNESSES,
  normalizeCatalogModel,
  validateCatalogModel,
  validateEffortForModel,
  validateHarness,
  type ModelCatalogEntry,
} from './model-catalog.js'

type RuntimeInput = Pick<Agent, 'name' | 'model' | 'harness' | 'resourceRefs'>
type ConfigResourceLookup = Pick<ConfigResourceRepo, 'get' | 'list'>

export interface ValidatedAgentRuntime<T extends RuntimeInput> {
  agent: T
  model: string
  harness: Agent['harness']
  effort: AgentEffort | null
  defaultCostTier: number
}

export function resolveAndValidateAgentRuntime<T extends RuntimeInput>(
  agent: T,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
  options: { effort?: string | null } = {},
): ValidatedAgentRuntime<T> {
  validateSandboxRefAtAvailableScope(agent, projectId, resources)
  validateWorkflowProfileRefAtAvailableScope(agent, projectId, resources)
  const resolved = resolveAgentRuntimeDetails(agent, projectId, resources, { resolveSandboxRef: false })
  const harness = resolved.harnessResource == null
    ? validateHarness(resolved.agent.harness)
    : resolved.agent.harness as Agent['harness']
  const model = resolved.modelResource == null
    ? normalizeCatalogModel(resolved.agent.model)
    : resolved.agent.model.trim()
  const catalogHarness = knownHarness(harness)
  const catalog = resolved.modelResource == null
    ? catalogHarness == null
      ? validateCatalogModel(model)
      : validateDirectModelForHarness(agent.name, model, catalogHarness)
    : null
  const effort = resolved.modelResource == null
    ? validateEffortForModel(options.effort, model)
    : validateResourceModelEffort(options.effort, model, resolved.modelResource)
  if (resolved.modelResource != null) {
    validateResourceModelCompatibility(agent.name, model, harness, resolved.modelResource)
  }
  return {
    agent: { ...resolved.agent, model, harness },
    model,
    harness,
    effort,
    defaultCostTier: catalog?.defaultCostTier ?? defaultCostTierFor(model),
  }
}

function validateDirectModelForHarness(
  agentName: string,
  model: string,
  harnessType: Agent['harness'],
): ModelCatalogEntry {
  const entry = validateCatalogModel(model)
  if (!entry.supportedHarnesses.includes(harnessType)) {
    throw new ValidationError(
      `Agent ${agentName} direct model ID ${entry.id} provider ID ${entry.provider} is not supported by Harness adapter type ${harnessType}`,
      { directModelId: entry.id, providerId: entry.provider, harnessType },
    )
  }
  return entry
}

function validateResourceModelCompatibility(
  agentName: string,
  providerModelId: string,
  harnessType: string,
  resource: ConfigResource,
): void {
  const spec = resource.spec as Partial<ModelSpec>
  assertFactorySettingsAgentCompatible({
    agentName,
    ductumModelId: resource.name,
    providerId: typeof spec.provider === 'string' ? spec.provider : '',
    providerModelId,
    harnessType,
  })
}

function validateWorkflowProfileRefAtAvailableScope<T extends RuntimeInput>(
  agent: T,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
): void {
  if (agent.resourceRefs?.workflowProfileRef == null) return
  resolveAgentWorkflowProfile(agent, projectId, resources)
}

function validateSandboxRefAtAvailableScope<T extends RuntimeInput>(
  agent: T,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
): void {
  if (agent.resourceRefs?.sandboxRef == null) return
  const sandboxRef = agent.resourceRefs.sandboxRef
  const resolved = resolveAgentSandboxProfileDetails(
    { name: agent.name, resourceRefs: { sandboxRef } },
    projectId,
    resources,
  )
  assertSupportedSandboxProfileSpec(resolved.profile, resolved.resource.spec)
}

function validateResourceModelEffort(
  effort: string | null | undefined,
  model: string,
  resource: ConfigResource,
): AgentEffort | null {
  if (effort == null || effort === '') return null
  if (!isAgentEffort(effort)) {
    throw new ValidationError(`Invalid effort: ${effort}`)
  }
  const supported = (resource.spec as Partial<ModelSpec>).supportedEfforts
  if (supported == null) {
    throw new ValidationError(`Model resource ${resource.name} must define supportedEfforts to validate effort ${effort} for model ${model}`)
  }
  if (supported != null && !supported.includes(effort)) {
    throw new ValidationError(`Effort ${effort} is not supported by model ${model}`, {
      model,
      supportedEfforts: supported,
    })
  }
  return effort
}

function knownHarness(value: string): Agent['harness'] | null {
  return HARNESSES.some((harness) => harness.id === value) ? value as Agent['harness'] : null
}

function isAgentEffort(value: string): value is AgentEffort {
  return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value)
}
