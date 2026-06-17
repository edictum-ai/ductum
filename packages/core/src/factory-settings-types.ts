import type {
  AgentCapability,
  AgentEffort,
  AgentResourceRefs,
  AgentSpawnConfig,
  AgentRole,
  MergeMode,
} from './types.js'
import type { ModelAvailability, ModelPricingState, ModelScannerKind, RegistryRates } from './model-registry.js'

export type FactorySettingsRecordType =
  | 'Provider'
  | 'Model'
  | 'Harness'
  | 'Workflow'
  | 'Agent'
  | 'SandboxProfile'
  | 'NotificationChannel'
  | 'Secret'
  | 'FactorySettings'
  | 'RuntimeSettings'
  | 'BudgetPreferences'
  | 'RuntimePreferences'

export type FactorySettingsScope = 'factory' | 'project'
export type FactorySettingsSource = 'saved' | 'built-in' | 'derived'

export interface FactorySettingsRecordBase<T extends FactorySettingsRecordType> {
  recordType: T
  id: string
  name: string
  scope: FactorySettingsScope
  projectId: string | null
  source: FactorySettingsSource
}

export interface FactorySettingsProvider extends FactorySettingsRecordBase<'Provider'> {
  providerId: string
  label: string
  modelCount: number
}

export interface FactorySettingsModel extends FactorySettingsRecordBase<'Model'> {
  modelId: string
  providerId: string
  providerModelId: string
  supportedEfforts?: AgentEffort[]
  supportedOptions?: string[]
  supportedHarnesses?: string[]
  availability?: ModelAvailability
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number }
  pricingState?: ModelPricingState
  pricingNote?: string
  rates?: RegistryRates
  scannerSource?: ModelScannerKind | string
  sourceUrl?: string
  lastVerifiedAt?: string
  enabled?: boolean
}

export interface FactorySettingsHarness extends FactorySettingsRecordBase<'Harness'> {
  harnessId: string
  adapterType: string
  command?: string
  runtime?: string
  controlMode?: string
  supportedSandboxes?: string[]
  supportedProviders?: string[]
  requiredSecretRefs?: string[]
  restartBehavior?: string
  testCommand?: string
  healthStatus?: 'unknown' | 'not_checked' | 'healthy' | 'unhealthy'
}

export interface FactorySettingsWorkflowValidation {
  valid: boolean
  error?: string
  setupCommands?: string[]
  verifyCommands?: string[]
}

export interface FactorySettingsWorkflow extends FactorySettingsRecordBase<'Workflow'> {
  workflowId: string
  path: string
  description?: string
  presetId?: string
  validation?: FactorySettingsWorkflowValidation
}

export interface FactorySettingsAgentSettings {
  capabilities: AgentCapability[]
  effort: AgentEffort | null
  costTier: number
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null
  spawnConfig: AgentSpawnConfig
}

export interface FactorySettingsAgent extends FactorySettingsRecordBase<'Agent'> {
  role: AgentRole
  modelRef?: string
  modelId: string
  providerId: string
  providerModelId: string
  harnessRef?: string
  harnessId: string
  harnessType: string
  sandboxRef?: string
  workflowProfileRef?: string
  systemPromptRef?: string
  sandboxProfileId?: string
  notificationChannelId?: string
  toolsRef?: string
  policyRef?: string
  secretAccessRefs: string[]
  resourceRefs: AgentResourceRefs
  settings: FactorySettingsAgentSettings
  enabled: boolean
}

export interface FactorySettingsSandboxProfile extends FactorySettingsRecordBase<'SandboxProfile'> {
  sandboxProfileId: string
  provider: string
  mode: string
}

export interface FactorySettingsNotificationChannel extends FactorySettingsRecordBase<'NotificationChannel'> {
  notificationChannelId: string
  backend: string
  configured: boolean
}

export interface FactorySettingsBudgetPreferences extends FactorySettingsRecordBase<'BudgetPreferences'> {
  perRunWarnUsd: number | null
  perRunHardUsd: number | null
  perSpecHardUsd: number | null
}

export interface FactorySettingsRuntimePreferences extends FactorySettingsRecordBase<'RuntimePreferences'> {
  defaultMergeMode: MergeMode
  heartbeatTimeoutSeconds: number
}

export type FactorySettingsAffectedRuntime =
  | 'api'
  | 'dashboard'
  | 'dispatcher'
  | 'harnesses'
  | 'notifications'
  | 'active_attempts'

export interface FactorySettingsWriteResult<TCurrent, TDesired> {
  applied: boolean
  restartRequired: boolean
  affectedRuntimes: FactorySettingsAffectedRuntime[]
  current: TCurrent
  desired: TDesired
}

export interface FactorySettingsDetails {
  recordType: 'FactorySettings'
  factoryId: string | null
  name: string
  defaultMergeMode: MergeMode
  heartbeatTimeoutSeconds: number
  budgets: FactorySettingsBudgetPreferences
  worktree: {
    enabled: boolean | null
    basePath: string | null
  }
}

export interface FactorySettingsPatch {
  name?: string
  defaultMergeMode?: MergeMode
  heartbeatTimeoutSeconds?: number
  budgets?: FactorySettingsCostBudgetInput
}

export interface FactoryRuntimePersistedSettings {
  apiBindHost: string | null
  apiPort: number | null
  publicApiUrl: string | null
  dashboardUrl: string | null
  dispatcherEnabled: boolean | null
  dispatcherHeartbeatIntervalSeconds: number | null
  worktreeEnabled: boolean | null
  worktreeBasePath: string | null
}

export interface FactoryRuntimeMergeConfig {
  push: boolean
  base: string
  strategy: 'merge' | 'squash' | 'rebase'
  pushTags: boolean
}

export interface FactoryRuntimeWorkflowProfileEntry {
  source: 'db' | 'env'
  projectId: string | null
  projectName: string | null
  name: string
  path: string
}

export interface FactoryRuntimeWorkflowProfileConfig {
  entries: FactoryRuntimeWorkflowProfileEntry[]
}

export interface FactoryRuntimeDesiredSettings extends FactoryRuntimePersistedSettings {
  heartbeatTimeoutSeconds: number | null
  mergeConfig: FactoryRuntimeMergeConfig
  costBudget: FactorySettingsCostBudgetInput
  workflowProfiles: FactoryRuntimeWorkflowProfileConfig
}

export type FactoryRuntimePatch = Partial<FactoryRuntimePersistedSettings>

export interface FactoryRuntimeCurrentSettings {
  apiBindHost: string | null
  apiPort: number | null
  publicApiUrl: string | null
  dashboardUrl: string | null
  dbPath: string | null
  factoryDataDir: string | null
  dispatcherRunning: boolean
  dispatcherEnabled: boolean
  dispatcherHeartbeatIntervalSeconds: number | null
  heartbeatTimeoutSeconds: number | null
  worktreeEnabled: boolean | null
  worktreeBasePath: string | null
  mergeConfig: FactoryRuntimeMergeConfig
  costBudget: FactorySettingsCostBudgetInput
  workflowProfiles: FactoryRuntimeWorkflowProfileConfig
}

export interface FactoryRuntimeSettings {
  recordType: 'RuntimeSettings'
  current: FactoryRuntimeCurrentSettings | null
  desired: FactoryRuntimeDesiredSettings
  restartRequired: boolean
  affectedRuntimes: FactorySettingsAffectedRuntime[]
}

export type FactorySecretScope = 'factory' | 'project'
export type FactorySecretStatus = 'configured' | 'missing' | 'test_failed' | 'unknown'

export interface FactorySecretMetadata {
  id: string
  name: string
  scope: FactorySecretScope
  status: FactorySecretStatus
  createdAt: string
  updatedAt: string
  lastRotatedAt: string | null
  lastTestedAt: string | null
}

export interface FactorySettingsCatalogs {
  providers: FactorySettingsProvider[]
  models: FactorySettingsModel[]
  harnesses: FactorySettingsHarness[]
  workflows: FactorySettingsWorkflow[]
  agents: FactorySettingsAgent[]
  sandboxProfiles: FactorySettingsSandboxProfile[]
  notificationChannels: FactorySettingsNotificationChannel[]
  budgets: FactorySettingsBudgetPreferences
  runtimePreferences: FactorySettingsRuntimePreferences
}

export interface FactorySettingsCostBudgetInput {
  perRunWarnUsd?: number | null
  perRunHardUsd?: number | null
  perSpecHardUsd?: number | null
}
