import type { Agent, Factory } from './types.js'
import type {
  ConfigResource,
  HarnessSpec,
  NotificationChannelSpec,
  SandboxProfileSpec,
  WorkflowProfileSpec,
} from './resource-types.js'
import { MODEL_REGISTRY, resolveModelEntry } from './model-registry.js'
import { redactPublicSpawnConfig } from './public-redaction.js'
import {
  collectSecretRefs,
  findHarness,
  findModel,
  supportedProvidersForHarness,
} from './factory-settings-catalog-helpers.js'
import { buildFactorySettingsModels } from './factory-settings-models.js'
import type {
  FactorySettingsAgent,
  FactorySettingsCatalogs,
  FactorySettingsCostBudgetInput,
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsNotificationChannel,
  FactorySettingsProvider,
  FactorySettingsRuntimePreferences,
  FactorySettingsSandboxProfile,
  FactorySettingsWorkflow,
} from './factory-settings-types.js'

export const BUILT_IN_WORKFLOW_PRESETS: FactorySettingsWorkflow[] = [
  {
    recordType: 'Workflow',
    id: 'builtin-workflow-coding-guard',
    name: 'coding-guard',
    workflowId: 'coding-guard',
    scope: 'factory',
    projectId: null,
    source: 'built-in',
    presetId: 'coding-guard',
    path: 'workflows/coding-guard-profile.yaml',
    description: 'Built-in guarded coding workflow preset',
  },
]

export interface BuildFactorySettingsCatalogsInput {
  factory?: Factory | null
  configResources: ConfigResource[]
  agents: Agent[]
  costBudget?: FactorySettingsCostBudgetInput
}

export function buildFactorySettingsCatalogs(input: BuildFactorySettingsCatalogsInput): FactorySettingsCatalogs {
  const models = buildFactorySettingsModels(input.configResources)
  const harnesses = input.configResources.flatMap(harnessFromResource)
  const workflows = buildWorkflowCatalog(input.configResources)
  return {
    providers: providersFromModels(models),
    models,
    harnesses,
    workflows,
    agents: input.agents.map((agent) => agentFromAgent(agent, models, harnesses)),
    sandboxProfiles: input.configResources.flatMap(sandboxFromResource),
    notificationChannels: input.configResources.flatMap(notificationFromResource),
    budgets: budgetPreferences(input.costBudget),
    runtimePreferences: runtimePreferences(input.factory),
  }
}

function buildWorkflowCatalog(configResources: ConfigResource[]): FactorySettingsWorkflow[] {
  const savedWorkflows = configResources.flatMap(workflowFromResource)
  const shadowedPresetIds = new Set(
    savedWorkflows
      .map((workflow) => workflow.presetId)
      .filter((presetId): presetId is string => typeof presetId === 'string' && presetId.trim() !== ''),
  )
  return [
    ...BUILT_IN_WORKFLOW_PRESETS
      .filter((preset) => !shadowedPresetIds.has(preset.presetId ?? preset.workflowId))
      .map((preset) => ({ ...preset })),
    ...savedWorkflows,
  ]
}

function harnessFromResource(resource: ConfigResource): FactorySettingsHarness[] {
  if (resource.kind !== 'Harness') return []
  const spec = resource.spec as Partial<HarnessSpec>
  const adapterType = spec.type ?? resource.name
  return [{
    recordType: 'Harness',
    id: resource.id,
    name: resource.name,
    harnessId: resource.name,
    adapterType,
    command: spec.command,
    runtime: spec.runtime ?? spec.command,
    controlMode: spec.controlMode,
    supportedSandboxes: spec.supportedSandboxes,
    supportedProviders: spec.supportedProviders ?? supportedProvidersForHarness(adapterType),
    requiredSecretRefs: spec.requiredSecretRefs,
    restartBehavior: spec.restartBehavior,
    testCommand: spec.testCommand,
    healthStatus: 'not_checked',
    scope: scope(resource),
    projectId: resource.projectId,
    source: 'saved',
  }]
}

function workflowFromResource(resource: ConfigResource): FactorySettingsWorkflow[] {
  if (resource.kind !== 'WorkflowProfile') return []
  const spec = resource.spec as Partial<WorkflowProfileSpec>
  const preset = builtInWorkflowPresetForName(resource.name)
  return [{
    recordType: 'Workflow',
    id: resource.id,
    name: resource.name,
    workflowId: resource.name,
    path: spec.path ?? '',
    description: spec.description,
    presetId: preset?.presetId,
    scope: scope(resource),
    projectId: resource.projectId,
    source: 'saved',
  }]
}

function builtInWorkflowPresetForName(name: string): FactorySettingsWorkflow | undefined {
  return BUILT_IN_WORKFLOW_PRESETS.find((preset) =>
    preset.name === name || preset.workflowId === name || preset.presetId === name,
  )
}

function sandboxFromResource(resource: ConfigResource): FactorySettingsSandboxProfile[] {
  if (resource.kind !== 'SandboxProfile') return []
  const spec = resource.spec as Partial<SandboxProfileSpec>
  return [{
    recordType: 'SandboxProfile',
    id: resource.id,
    name: resource.name,
    sandboxProfileId: resource.name,
    provider: spec.provider ?? 'unknown',
    mode: spec.mode ?? 'unknown',
    scope: scope(resource),
    projectId: resource.projectId,
    source: 'saved',
  }]
}

function notificationFromResource(resource: ConfigResource): FactorySettingsNotificationChannel[] {
  if (resource.kind !== 'NotificationChannel') return []
  const spec = resource.spec as Partial<NotificationChannelSpec>
  return [{
    recordType: 'NotificationChannel',
    id: resource.id,
    name: resource.name,
    notificationChannelId: resource.name,
    backend: spec.backend ?? 'unknown',
    configured: Object.keys(spec.config ?? {}).length > 0,
    scope: scope(resource),
    projectId: resource.projectId,
    source: 'saved',
  }]
}

function providersFromModels(models: FactorySettingsModel[]): FactorySettingsProvider[] {
  const providers = new Map<string, FactorySettingsProvider>()
  for (const entry of MODEL_REGISTRY) {
    providers.set(entry.provider, providerRecord(entry.provider, 'derived'))
  }
  for (const model of models) {
    providers.set(model.providerId, providerRecord(model.providerId, 'saved'))
  }
  for (const provider of providers.values()) {
    provider.modelCount = models.filter((model) => model.providerId === provider.providerId).length
  }
  return [...providers.values()].sort((a, b) => a.providerId.localeCompare(b.providerId))
}

function agentFromAgent(
  agent: Agent,
  models: FactorySettingsModel[],
  harnesses: FactorySettingsHarness[],
): FactorySettingsAgent {
  const refs = agent.resourceRefs ?? {}
  const model = findModel(models, refs.modelRef, agent.model)
  const registryEntry = resolveModelEntry(agent.model)
  const harness = findHarness(harnesses, refs.harnessRef, agent.harness)
  return {
    recordType: 'Agent',
    id: agent.id,
    name: agent.name,
    role: roleFromCapabilities(agent.capabilities),
    modelRef: refs.modelRef,
    modelId: model?.modelId ?? refs.modelRef ?? agent.model,
    providerId: model?.providerId ?? registryEntry?.provider ?? 'unknown',
    providerModelId: model?.providerModelId ?? agent.model,
    harnessRef: refs.harnessRef,
    harnessId: harness?.harnessId ?? refs.harnessRef ?? agent.harness,
    harnessType: harness?.adapterType ?? agent.harness,
    sandboxRef: refs.sandboxRef,
    workflowProfileRef: refs.workflowProfileRef,
    systemPromptRef: refs.systemPromptRef,
    sandboxProfileId: refs.sandboxRef,
    notificationChannelId: undefined,
    toolsRef: refs.toolsRef,
    policyRef: refs.policyRef,
    secretAccessRefs: collectSecretRefs(agent.spawnConfig),
    resourceRefs: refs,
    settings: {
      capabilities: agent.capabilities,
      effort: agent.effort ?? null,
      costTier: agent.costTier,
      pricing: agent.pricing,
      spawnConfig: redactPublicSpawnConfig(agent.spawnConfig),
    },
    enabled: true,
    scope: 'factory',
    projectId: null,
    source: 'saved',
  }
}

function budgetPreferences(costBudget: FactorySettingsCostBudgetInput = {}) {
  return {
    recordType: 'BudgetPreferences' as const,
    id: 'factory-budget-preferences',
    name: 'Factory budgets',
    perRunWarnUsd: costBudget.perRunWarnUsd ?? null,
    perRunHardUsd: costBudget.perRunHardUsd ?? null,
    perSpecHardUsd: costBudget.perSpecHardUsd ?? null,
    scope: 'factory' as const,
    projectId: null,
    source: 'saved' as const,
  }
}

function runtimePreferences(factory: Factory | null | undefined): FactorySettingsRuntimePreferences {
  return {
    recordType: 'RuntimePreferences',
    id: 'factory-runtime-preferences',
    name: 'Factory runtime',
    defaultMergeMode: factory?.config.defaultMergeMode ?? 'human',
    heartbeatTimeoutSeconds: factory?.config.heartbeatTimeoutSeconds ?? 120,
    scope: 'factory',
    projectId: null,
    source: 'saved',
  }
}

function providerRecord(providerId: string, source: FactorySettingsProvider['source']): FactorySettingsProvider {
  return {
    recordType: 'Provider',
    id: `provider:${providerId}`,
    name: providerLabel(providerId),
    providerId,
    label: providerLabel(providerId),
    modelCount: 0,
    scope: 'factory',
    projectId: null,
    source,
  }
}

function roleFromCapabilities(capabilities: Agent['capabilities']) {
  if (capabilities.includes('review')) return 'reviewer'
  if (capabilities.includes('docs')) return 'docs'
  return 'builder'
}

function scope(resource: ConfigResource) {
  return resource.projectId == null ? 'factory' as const : 'project' as const
}

function providerLabel(providerId: string): string {
  if (providerId === 'openai') return 'OpenAI'
  if (providerId === 'anthropic') return 'Anthropic'
  if (providerId === 'zai') return 'Z.AI'
  return providerId
}
