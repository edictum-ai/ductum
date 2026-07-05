import { attemptCeilingPreferences } from '@ductum/core'
import type {
  FactoryRuntimeDesiredSettings,
  FactoryRuntimeCurrentSettings,
  FactoryRuntimeMergeConfig,
  FactoryRuntimePersistedSettings,
  FactoryRuntimeWorkflowProfileConfig,
  FactoryRuntimeSettings,
  FactorySettingsDetails,
  FactorySettingsCostBudgetInput,
  FactorySettingsWriteResult,
  FactorySettingsAffectedRuntime,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { restartAffectedRuntimes } from './factory-settings-restart.js'
export { affectedRuntimesForPatch, restartAffectedRuntimes } from './factory-settings-restart.js'

const EMPTY_PERSISTED_RUNTIME: FactoryRuntimePersistedSettings = {
  apiBindHost: null,
  apiPort: null,
  publicApiUrl: null,
  dashboardUrl: null,
  dispatcherEnabled: null,
  dispatcherHeartbeatIntervalSeconds: null,
  worktreeEnabled: null,
  worktreeBasePath: null,
}

const DEFAULT_MERGE_CONFIG: FactoryRuntimeMergeConfig = {
  push: false,
  base: 'main',
  strategy: 'merge',
  pushTags: false,
  approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
}

export function buildFactorySettingsDetails(context: ApiContext): FactorySettingsDetails {
  const factory = context.repos.factory.get()
  const desired = factory == null ? EMPTY_PERSISTED_RUNTIME : persistedRuntimeDesired(context, factory.id)
  const savedBudget = normalizeCostBudget(factory?.config.costBudget)
  const budget = hasBudgetKeys(savedBudget) ? savedBudget : normalizeCostBudget(context.costBudget)
  return {
    recordType: 'FactorySettings',
    factoryId: factory?.id ?? null,
    name: factory?.name ?? 'Ductum',
    defaultMergeMode: factory?.config.defaultMergeMode ?? 'human',
    heartbeatTimeoutSeconds: factory?.config.heartbeatTimeoutSeconds ?? 120,
    budgets: {
      recordType: 'BudgetPreferences',
      id: 'factory-budget-preferences',
      name: 'Factory budgets',
      perRunWarnUsd: budget.perRunWarnUsd ?? null,
      perRunHardUsd: budget.perRunHardUsd ?? null,
      perSpecHardUsd: budget.perSpecHardUsd ?? null,
      scope: 'factory',
      projectId: null,
      source: 'saved',
    },
    attemptCeilings: attemptCeilingPreferences(factory?.config.attemptCeilings),
    worktree: {
      enabled: desired.worktreeEnabled,
      basePath: desired.worktreeBasePath,
    },
  }
}

export function buildFactoryRuntimeSettings(context: ApiContext): FactoryRuntimeSettings {
  const factory = context.repos.factory.get()
  const current = factory == null ? null : runtimeCurrent(context)
  const desired = factory == null ? runtimeDesiredFrom(null, EMPTY_PERSISTED_RUNTIME, context) : runtimeDesired(context, factory.id)
  const affectedRuntimes = current == null ? [] : restartAffectedRuntimes(current, desired)
  return {
    recordType: 'RuntimeSettings',
    current,
    desired,
    restartRequired: affectedRuntimes.length > 0,
    affectedRuntimes,
  }
}

export function settingsWriteResult(
  current: FactorySettingsDetails,
  desired: FactorySettingsDetails,
  options: {
    applied?: boolean
    restartRequired?: boolean
    affectedRuntimes?: FactorySettingsAffectedRuntime[]
  } = {},
): FactorySettingsWriteResult<FactorySettingsDetails, FactorySettingsDetails> {
  return {
    applied: options.applied ?? true,
    restartRequired: options.restartRequired ?? false,
    affectedRuntimes: options.affectedRuntimes ?? [],
    current,
    desired,
  }
}

export function runtimeWriteResult(
  current: FactoryRuntimeCurrentSettings | null,
  desired: FactoryRuntimeDesiredSettings,
  affectedRuntimes: FactorySettingsAffectedRuntime[],
): FactorySettingsWriteResult<FactoryRuntimeCurrentSettings | null, FactoryRuntimeDesiredSettings> {
  const restartRequired = affectedRuntimes.length > 0
  return {
    applied: !restartRequired,
    restartRequired,
    affectedRuntimes,
    current,
    desired,
  }
}

export function runtimeDesired(context: ApiContext, factoryId: string): FactoryRuntimeDesiredSettings {
  const factory = context.repos.factory.get()
  return runtimeDesiredFrom(factory, persistedRuntimeDesired(context, factoryId), context)
}

export function normalizeCostBudget(value: unknown): FactorySettingsCostBudgetInput {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    ...numberOrNull(input.perRunWarnUsd, 'perRunWarnUsd'),
    ...numberOrNull(input.perRunHardUsd, 'perRunHardUsd'),
    ...numberOrNull(input.perSpecHardUsd, 'perSpecHardUsd'),
  }
}

function persistedRuntimeDesired(context: ApiContext, factoryId: string): FactoryRuntimePersistedSettings {
  const record = context.repos.runtimeSettings.get(factoryId as never)
  if (record == null) return EMPTY_PERSISTED_RUNTIME
  return {
    apiBindHost: record.apiBindHost,
    apiPort: record.apiPort,
    publicApiUrl: record.publicApiUrl,
    dashboardUrl: record.dashboardUrl,
    dispatcherEnabled: record.dispatcherEnabled,
    dispatcherHeartbeatIntervalSeconds: record.dispatcherHeartbeatIntervalSeconds,
    worktreeEnabled: record.worktreeEnabled,
    worktreeBasePath: record.worktreeBasePath,
  }
}

function runtimeDesiredFrom(
  factory: ReturnType<ApiContext['repos']['factory']['get']>,
  persisted: FactoryRuntimePersistedSettings,
  context: ApiContext,
): FactoryRuntimeDesiredSettings {
  return {
    ...persisted,
    heartbeatTimeoutSeconds: factory?.config.heartbeatTimeoutSeconds ?? null,
    mergeConfig: mergeConfig(context.merge),
    costBudget: normalizeCostBudget(factory?.config.costBudget),
    attemptCeilings: attemptCeilingPreferences(factory?.config.attemptCeilings),
    workflowProfiles: dbWorkflowProfiles(context),
  }
}

function runtimeCurrent(context: ApiContext): FactoryRuntimeCurrentSettings {
  const status = context.getDispatcherStatus?.()
  const runtimeConfig = context.getRuntimeConfig?.()
  return {
    apiBindHost: context.runtime.apiBindHost ?? null,
    apiPort: context.runtime.apiPort ?? null,
    publicApiUrl: context.runtime.publicApiUrl ?? null,
    dashboardUrl: context.runtime.dashboardUrl ?? null,
    dbPath: context.runtime.dbPath ?? null,
    factoryDataDir: context.runtime.factoryDataDir ?? null,
    dispatcherRunning: status?.running ?? false,
    dispatcherEnabled: status?.enabled ?? context.runtime.dispatcherEnabled ?? false,
    dispatcherHeartbeatIntervalSeconds: runtimeConfig?.pollIntervalMs == null
      ? context.runtime.dispatcherHeartbeatIntervalSeconds ?? null
      : Math.round(runtimeConfig.pollIntervalMs / 1000),
    heartbeatTimeoutSeconds: runtimeConfig?.heartbeatTimeoutSeconds
      ?? context.runtime.heartbeatTimeoutSeconds
      ?? null,
    worktreeEnabled: context.runtime.worktreeEnabled ?? null,
    worktreeBasePath: context.runtime.worktreeBasePath ?? null,
    mergeConfig: mergeConfig(context.merge),
    costBudget: normalizeCostBudget(context.costBudget),
    attemptCeilings: attemptCeilingPreferences(runtimeConfig?.attemptCeilings),
    workflowProfiles: context.runtime.workflowProfiles,
  }
}

type MergeConfigInput = Omit<Partial<FactoryRuntimeMergeConfig>, 'approvalCiGate'> & {
  approvalCiGate?: Partial<FactoryRuntimeMergeConfig['approvalCiGate']> | undefined
}

function mergeConfig(value: MergeConfigInput | undefined): FactoryRuntimeMergeConfig {
  return {
    push: value?.push ?? DEFAULT_MERGE_CONFIG.push,
    base: value?.base ?? DEFAULT_MERGE_CONFIG.base,
    strategy: value?.strategy ?? DEFAULT_MERGE_CONFIG.strategy,
    pushTags: value?.pushTags ?? DEFAULT_MERGE_CONFIG.pushTags,
    approvalCiGate: approvalCiGate(value?.approvalCiGate),
  }
}

function approvalCiGate(
  value: Partial<FactoryRuntimeMergeConfig['approvalCiGate']> | undefined,
): FactoryRuntimeMergeConfig['approvalCiGate'] {
  const base = DEFAULT_MERGE_CONFIG.approvalCiGate
  if (value == null) return { ...base }
  const requiredChecks = Array.isArray(value.requiredChecks)
    ? value.requiredChecks.filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    : []
  return {
    enabled: value.enabled ?? base.enabled,
    requiredChecks,
    failClosedOnMissing: value.failClosedOnMissing ?? base.failClosedOnMissing,
  }
}

function dbWorkflowProfiles(context: ApiContext): FactoryRuntimeWorkflowProfileConfig {
  return {
    entries: context.repos.configResources.list()
      .filter((resource) => resource.kind === 'WorkflowProfile')
      .map((resource) => {
        const spec = resource.spec as { path?: unknown }
        return {
          source: 'db' as const,
          projectId: resource.projectId,
          projectName: null,
          name: resource.name,
          path: typeof spec.path === 'string' ? spec.path : '',
        }
      }),
  }
}

function numberOrNull(value: unknown, field: keyof FactorySettingsCostBudgetInput) {
  if (value === undefined) return {}
  if (value === null) return { [field]: null }
  return typeof value === 'number' && Number.isFinite(value) ? { [field]: value } : {}
}

function hasBudgetKeys(value: FactorySettingsCostBudgetInput): boolean {
  return ['perRunWarnUsd', 'perRunHardUsd', 'perSpecHardUsd'].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  )
}
