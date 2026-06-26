import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_WORKFLOW_PRESETS,
  FactorySettingsValidationError,
  assertFactorySettingsAgentCompatible,
  buildFactorySettingsCatalogs,
  type Agent,
  type ConfigResource,
  type Factory,
} from '../index.js'

const now = '2026-05-25T00:00:00.000Z'

describe('Factory Settings facade', () => {
  it('maps existing settings storage into concrete public records', () => {
    const catalogs = buildFactorySettingsCatalogs({
      factory,
      configResources: resources,
      agents: [agent],
      costBudget: { perSpecHardUsd: 200 },
    })

    expect(catalogs).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ recordType: 'Provider', providerId: 'openai' }),
      ]),
      models: expect.arrayContaining([
        expect.objectContaining({
          recordType: 'Model',
          modelId: 'gpt-5-4',
          providerId: 'openai',
          providerModelId: 'gpt-5.4',
          scannerSource: 'codex',
          pricingState: 'measured',
          catalogSource: 'live-registry',
          savedConfigState: 'resource-authored',
          pricingSource: 'registry',
          lastVerifiedAt: '2026-06-13',
          sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4',
          enabled: true,
        }),
      ]),
      harnesses: [expect.objectContaining({
        recordType: 'Harness',
        harnessId: 'codex-sdk',
        adapterType: 'codex-sdk',
        requiredSecretRefs: ['secret:openai-api-key'],
      })],
      workflows: expect.arrayContaining([
        expect.objectContaining({ recordType: 'Workflow', presetId: 'coding-guard' }),
        expect.objectContaining({ recordType: 'Workflow', workflowId: 'custom' }),
      ]),
      agents: [expect.objectContaining({
        recordType: 'Agent',
        modelId: 'gpt-5-4',
        modelRef: 'gpt-5-4',
        providerId: 'openai',
        providerModelId: 'gpt-5.4',
        harnessId: 'codex-sdk',
        harnessRef: 'codex-sdk',
        sandboxRef: 'builder-worktree',
        secretAccessRefs: [],
      })],
      sandboxProfiles: [expect.objectContaining({ recordType: 'SandboxProfile' })],
      notificationChannels: [expect.objectContaining({ recordType: 'NotificationChannel' })],
      budgets: expect.objectContaining({ recordType: 'BudgetPreferences', perSpecHardUsd: 200 }),
      runtimePreferences: expect.objectContaining({ recordType: 'RuntimePreferences', defaultMergeMode: 'human' }),
    })
  })

  it('keeps Ductum model identity separate from provider model ID', () => {
    const catalogs = buildFactorySettingsCatalogs({ configResources: resources, agents: [] })
    const model = catalogs.models.find((item) => item.modelId === 'gpt-5-4')!

    expect(model.id).toBe('model-1')
    expect(model.modelId).toBe('gpt-5-4')
    expect(model.providerModelId).toBe('gpt-5.4')
    expect(model.pricingState).toBe('measured')
    expect(catalogs.models.filter((item) => item.providerModelId === 'gpt-5.4')).toHaveLength(1)
  })

  it('shows current registry metadata for existing DB-backed factories and appends missing built-ins', () => {
    const catalogs = buildFactorySettingsCatalogs({
      configResources: [{
        ...resources[0]!,
        name: 'gpt-5.4',
        spec: {
          provider: 'openai',
          modelId: 'gpt-5.4',
          sourceUrl: 'https://stale.example.invalid/gpt-5.4',
          lastVerifiedAt: '2026-01-01',
        },
      }],
      agents: [],
    })

    expect(catalogs.models.find((model) => model.modelId === 'gpt-5.4')).toMatchObject({
      source: 'saved',
      catalogSource: 'live-registry',
      savedConfigState: 'seed-frozen',
      sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.4',
      lastVerifiedAt: '2026-06-13',
    })
    expect(catalogs.models.find((model) => model.modelId === 'gpt-5.5')).toMatchObject({
      source: 'built-in',
      catalogSource: 'live-registry',
      savedConfigState: 'none',
      providerModelId: 'gpt-5.5',
    })
  })

  it('treats a saved pricing override as measured even when the registry row is unmeasured', () => {
    const catalogs = buildFactorySettingsCatalogs({
      configResources: [{
        id: 'spark-model' as ConfigResource['id'],
        kind: 'Model',
        projectId: null,
        name: 'spark-override',
        spec: {
          provider: 'openai',
          modelId: 'gpt-5.3-codex-spark',
          pricing: { inputUsdPer1M: 1.5, outputUsdPer1M: 6 },
        },
        createdAt: now,
        updatedAt: now,
      }],
      agents: [],
    })

    expect(catalogs.models.find((model) => model.modelId === 'spark-override')).toMatchObject({
      pricingState: 'measured',
      pricingSource: 'saved-resource',
      pricing: { inputUsdPer1M: 1.5, outputUsdPer1M: 6 },
      pricingNote: undefined,
    })
  })

  it('does not let a Copilot wrapper steal an explicitly referenced OpenAI model route', () => {
    const copilotModel: ConfigResource = {
      id: 'model-copilot' as ConfigResource['id'],
      kind: 'Model',
      projectId: null,
      name: 'github-copilot-gpt-5-4',
      spec: { provider: 'github-copilot', modelId: 'gpt-5.4', supportedEfforts: ['medium'] },
      createdAt: now,
      updatedAt: now,
    }
    const catalogs = buildFactorySettingsCatalogs({
      configResources: [copilotModel, ...resources],
      agents: [agent],
    })

    expect(catalogs.agents[0]).toMatchObject({
      modelId: 'gpt-5-4',
      providerId: 'openai',
      providerModelId: 'gpt-5.4',
    })
  })

  it('validates known Agent provider, model, and harness compatibility', () => {
    expect(() => assertFactorySettingsAgentCompatible({
      agentName: 'codex',
      ductumModelId: 'gpt-5-4',
      providerId: 'openai',
      providerModelId: 'gpt-5.4',
      harnessType: 'codex-sdk',
    })).not.toThrow()

    expect(() => assertFactorySettingsAgentCompatible({
      agentName: 'bad',
      ductumModelId: 'gpt-5-4',
      providerId: 'openai',
      providerModelId: 'gpt-5.4',
      harnessType: 'claude-agent-sdk',
    })).toThrow(FactorySettingsValidationError)
  })

  it('allows GitHub Copilot model resources to wrap provider model IDs served by Copilot', () => {
    expect(() => assertFactorySettingsAgentCompatible({
      agentName: 'copilot-builder',
      ductumModelId: 'github-copilot-gpt-5-4',
      providerId: 'github-copilot',
      providerModelId: 'gpt-5.4',
      harnessType: 'copilot-sdk',
    })).not.toThrow()
  })

  it('rejects provider/model ID drift', () => {
    expect(() => assertFactorySettingsAgentCompatible({
      agentName: 'bad-provider',
      ductumModelId: 'sonnet',
      providerId: 'openai',
      providerModelId: 'claude-sonnet-4-6',
      harnessType: 'claude-agent-sdk',
    })).toThrow('provider ID openai does not match provider model ID claude-sonnet-4-6')
  })

  it('rejects registered models with no supported harnesses', () => {
    expect(() => assertFactorySettingsAgentCompatible({
      agentName: 'bad-zai',
      ductumModelId: 'glm-5',
      providerId: 'zai',
      providerModelId: 'glm-5',
      harnessType: 'claude-agent-sdk',
    })).toThrow('provider model ID glm-5 is not supported by Harness adapter type claude-agent-sdk')
  })

  it('ships a built-in Workflow preset', () => {
    expect(BUILT_IN_WORKFLOW_PRESETS).toEqual([
      expect.objectContaining({
        recordType: 'Workflow',
        workflowId: 'coding-guard',
        presetId: 'coding-guard',
        path: 'workflows/coding-guard-profile.yaml',
      }),
    ])
  })
})

const factory: Factory = {
  id: 'factory-1' as Factory['id'],
  name: 'Ductum',
  config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  createdAt: now,
}

const resources: ConfigResource[] = [
  {
    id: 'model-1' as ConfigResource['id'],
    kind: 'Model',
    projectId: null,
    name: 'gpt-5-4',
    spec: { provider: 'openai', modelId: 'gpt-5.4', supportedEfforts: ['high', 'xhigh'] },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'harness-1' as ConfigResource['id'],
    kind: 'Harness',
    projectId: null,
    name: 'codex-sdk',
    spec: { type: 'codex-sdk', supportedSandboxes: ['host', 'worktree'], requiredSecretRefs: ['secret:openai-api-key'] },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'workflow-1' as ConfigResource['id'],
    kind: 'WorkflowProfile',
    projectId: null,
    name: 'custom',
    spec: { path: '.edictum/workflow-profile.yaml' },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'sandbox-1' as ConfigResource['id'],
    kind: 'SandboxProfile',
    projectId: null,
    name: 'builder-worktree',
    spec: { provider: 'host', mode: 'worktree' },
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'notification-1' as ConfigResource['id'],
    kind: 'NotificationChannel',
    projectId: null,
    name: 'telegram-operator',
    spec: { backend: 'telegram', config: { enabled: false } },
    createdAt: now,
    updatedAt: now,
  },
]

const agent: Agent = {
  id: 'agent-1' as Agent['id'],
  name: 'codex',
  model: 'gpt-5.4',
  harness: 'codex-sdk',
  resourceRefs: { modelRef: 'gpt-5-4', harnessRef: 'codex-sdk', sandboxRef: 'builder-worktree' },
  capabilities: ['build', 'test', 'fix'],
  effort: 'xhigh',
  costTier: 90,
  spawnConfig: {},
  createdAt: now,
}
