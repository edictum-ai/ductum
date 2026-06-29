import type {
  FactoryRuntimeSettings,
  FactorySecretMetadata,
  FactorySettingsCatalogs,
  FactorySettingsDetails,
  FactorySettingsWriteResult,
} from '@/api/factory-settings-types'
import type { NotificationChannelResource } from '@/api/client'

export function factorySettingsFixture(
  overrides: Partial<FactorySettingsCatalogs> = {},
): FactorySettingsCatalogs {
  const base: FactorySettingsCatalogs = {
    providers: [
      { recordType: 'Provider', id: 'prov_anthropic', name: 'Anthropic', scope: 'factory', projectId: null, providerId: 'anthropic', label: 'Anthropic', modelCount: 1, source: 'built-in' },
      { recordType: 'Provider', id: 'prov_openai', name: 'OpenAI', scope: 'factory', projectId: null, providerId: 'openai', label: 'OpenAI', modelCount: 1, source: 'built-in' },
    ],
    models: [
      { recordType: 'Model', id: 'model_sonnet', name: 'claude-sonnet-4-6', scope: 'factory', projectId: null, modelId: 'claude-sonnet-4-6', providerId: 'anthropic', providerModelId: 'claude-sonnet-4-6', source: 'saved' },
      { recordType: 'Model', id: 'model_gpt', name: 'gpt-5.4', scope: 'factory', projectId: null, modelId: 'gpt-5.4', providerId: 'openai', providerModelId: 'gpt-5.4', source: 'saved' },
    ],
    harnesses: [
      { recordType: 'Harness', id: 'harness_claude', name: 'claude-agent-sdk', scope: 'factory', projectId: null, harnessId: 'claude-agent-sdk', adapterType: 'claude-agent-sdk', controlMode: 'app-server', source: 'built-in' },
    ],
    workflows: [
      { recordType: 'Workflow', id: 'wf_guard', name: 'coding-guard', scope: 'factory', projectId: null, workflowId: 'coding-guard', path: 'PROCESS.md', validation: { valid: true }, source: 'saved' },
    ],
    agents: [
      {
        recordType: 'Agent',
        id: 'agent_atlas',
        name: 'Atlas',
        scope: 'factory',
        projectId: null,
        role: 'builder',
        modelRef: 'model_sonnet',
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
        providerModelId: 'claude-sonnet-4-6',
        harnessRef: 'harness_claude',
        harnessId: 'claude-agent-sdk',
        harnessType: 'claude-agent-sdk',
        sandboxRef: 'sandbox_builder',
        workflowProfileRef: 'wf_guard',
        enabled: true,
        secretAccessRefs: [],
        resourceRefs: { modelRef: 'model_sonnet', harnessRef: 'harness_claude', sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
        settings: { capabilities: ['build', 'review'], effort: 'xhigh', costTier: 70, spawnConfig: {} },
        source: 'saved',
      },
    ],
    sandboxProfiles: [
      { recordType: 'SandboxProfile', id: 'sandbox_builder', name: 'builder-worktree', scope: 'factory', projectId: null, sandboxProfileId: 'builder-worktree', provider: 'local', mode: 'preflight', source: 'saved' },
    ],
    notificationChannels: [
      { recordType: 'NotificationChannel', id: 'channel_ops', name: 'ops', scope: 'factory', projectId: null, notificationChannelId: 'ops', backend: 'telegram', configured: false, source: 'saved' },
    ],
    budgets: { recordType: 'BudgetPreferences', id: 'budgets', name: 'Budgets', scope: 'factory', projectId: null, perRunWarnUsd: 5, perRunHardUsd: 10, perSpecHardUsd: 50, source: 'saved' },
    runtimePreferences: { recordType: 'RuntimePreferences', id: 'runtime', name: 'Runtime defaults', scope: 'factory', projectId: null, defaultMergeMode: 'human', heartbeatTimeoutSeconds: 120, source: 'saved' },
    summary: {
      providerCount: 2,
      modelCount: 2,
      harnessCount: 1,
      workflowCount: 1,
      agentCount: 1,
      sandboxProfileCount: 1,
      notificationChannelCount: 1,
    },
  }
  const fixture = { ...base, ...overrides }
  return {
    ...fixture,
    summary: overrides.summary ?? {
      providerCount: fixture.providers.length,
      modelCount: fixture.models.length,
      harnessCount: fixture.harnesses.length,
      workflowCount: fixture.workflows.length,
      agentCount: fixture.agents.length,
      sandboxProfileCount: fixture.sandboxProfiles.length,
      notificationChannelCount: fixture.notificationChannels.length,
    },
  }
}

export function factorySettingsDetailsFixture(
  overrides: Partial<FactorySettingsDetails> = {},
): FactorySettingsDetails {
  return {
    recordType: 'FactorySettings',
    factoryId: 'fct_1',
    name: 'Ductum',
    defaultMergeMode: 'human',
    heartbeatTimeoutSeconds: 120,
    budgets: {
      recordType: 'BudgetPreferences',
      id: 'factory-budget-preferences',
      name: 'Factory budgets',
      scope: 'factory',
      projectId: null,
      perRunWarnUsd: 5,
      perRunHardUsd: 10,
      perSpecHardUsd: 50,
      source: 'saved',
    },
    worktree: { enabled: true, basePath: null },
    ...overrides,
  }
}

export function factoryRuntimeFixture(
  overrides: Partial<FactoryRuntimeSettings> = {},
): FactoryRuntimeSettings {
  return {
    recordType: 'RuntimeSettings',
    current: {
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      publicApiUrl: 'http://localhost:4100',
      dashboardUrl: 'http://localhost:5176',
      dbPath: '/factory/.ductum/factory.db',
      factoryDataDir: '/factory/.ductum',
      dispatcherRunning: true,
      dispatcherEnabled: true,
      dispatcherHeartbeatIntervalSeconds: 15,
      heartbeatTimeoutSeconds: 120,
      worktreeEnabled: true,
      worktreeBasePath: '/factory/worktrees',
      mergeConfig: {
        push: false,
        base: 'main',
        strategy: 'merge',
        pushTags: false,
        approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      },
      costBudget: { perRunWarnUsd: 5, perRunHardUsd: 10, perSpecHardUsd: 50 },
      workflowProfiles: { entries: [{ source: 'db', projectId: null, projectName: null, name: 'coding-guard', path: 'PROCESS.md' }] },
    },
    desired: {
      apiBindHost: null,
      apiPort: null,
      publicApiUrl: null,
      dashboardUrl: null,
      dispatcherEnabled: null,
      dispatcherHeartbeatIntervalSeconds: null,
      worktreeEnabled: null,
      worktreeBasePath: null,
      heartbeatTimeoutSeconds: 120,
      mergeConfig: {
        push: false,
        base: 'main',
        strategy: 'merge',
        pushTags: false,
        approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
      },
      costBudget: { perRunWarnUsd: 5, perRunHardUsd: 10, perSpecHardUsd: 50 },
      workflowProfiles: { entries: [] },
    },
    restartRequired: false,
    affectedRuntimes: [],
    ...overrides,
  }
}

export function secretMetadataFixture(
  overrides: Partial<FactorySecretMetadata> = {},
): FactorySecretMetadata {
  return {
    id: 'sec_1',
    name: 'anthropic-api-key',
    scope: 'factory',
    status: 'configured',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    lastRotatedAt: '2026-06-01T10:00:00.000Z',
    lastTestedAt: null,
    ...overrides,
  }
}

export function notificationChannelResourceFixture(
  overrides: Partial<NotificationChannelResource> = {},
): NotificationChannelResource {
  return {
    id: 'channel_ops',
    kind: 'NotificationChannel',
    projectId: null,
    name: 'ops',
    spec: {
      backend: 'telegram',
      config: {
        enabled: false,
        publicBaseUrl: 'https://factory.example.test',
      },
    },
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  }
}

/** Standard mock map for the typed Settings page reads. */
export function typedSettingsMocks(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/api/factory-settings': factorySettingsFixture(),
    'GET /api/factory/settings': factorySettingsDetailsFixture(),
    'GET /api/factory/runtime': factoryRuntimeFixture(),
    'GET /api/factory/secrets': [secretMetadataFixture()],
    'GET /api/resources/NotificationChannel': [notificationChannelResourceFixture()],
    ...extra,
  }
}

export function writeResultFixture<TCurrent, TDesired>(
  current: TCurrent,
  desired: TDesired,
  overrides: Partial<Pick<FactorySettingsWriteResult<TCurrent, TDesired>, 'applied' | 'restartRequired' | 'affectedRuntimes'>> = {},
): FactorySettingsWriteResult<TCurrent, TDesired> {
  return {
    applied: true,
    restartRequired: false,
    affectedRuntimes: [],
    current,
    desired,
    ...overrides,
  }
}
