import { afterEach, describe, expect, it } from 'vitest'
import type { FactorySettingsCatalogs } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Factory Settings API facade', () => {
  it('returns concrete Factory Settings catalogs backed by existing storage', async () => {
    fixture = await createFixture({ costBudget: { perSpecHardUsd: 200 } })
    seedFactorySettings(fixture)

    const result = await requestJson(fixture.app, '/api/factory-settings')

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ recordType: 'Provider', providerId: 'openai' }),
      ]),
      models: expect.arrayContaining([
        expect.objectContaining({
          recordType: 'Model',
          modelId: 'gpt-5-4',
          providerModelId: 'gpt-5.4',
          pricingState: 'measured',
          catalogSource: 'live-registry',
          lastVerifiedAt: '2026-06-13',
        }),
        expect.objectContaining({
          recordType: 'Model',
          modelId: 'gpt-5.5',
          source: 'built-in',
          providerModelId: 'gpt-5.5',
        }),
      ]),
      harnesses: [expect.objectContaining({ recordType: 'Harness', harnessId: 'codex-sdk' })],
      workflows: expect.arrayContaining([
        expect.objectContaining({
          recordType: 'Workflow',
          presetId: 'coding-guard',
          validation: expect.objectContaining({ valid: true }),
        }),
      ]),
      agents: [expect.objectContaining({
        recordType: 'Agent',
        modelId: 'gpt-5-4',
        providerId: 'openai',
        providerModelId: 'gpt-5.4',
        harnessId: 'codex-sdk',
      })],
      sandboxProfiles: [expect.objectContaining({ recordType: 'SandboxProfile' })],
      notificationChannels: [expect.objectContaining({ recordType: 'NotificationChannel' })],
      budgets: expect.objectContaining({ recordType: 'BudgetPreferences', perSpecHardUsd: 200 }),
    })
  })

  it('does not return duplicate coding-guard workflows when a saved record shadows the built-in preset', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: 'factory-1' as never,
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    fixture.repos.projects.create({
      id: 'project-1' as never,
      factoryId: 'factory-1' as never,
      name: 'factory',
      repos: ['.'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.configResources.create({
      id: 'workflow-seeded' as never,
      kind: 'WorkflowProfile',
      projectId: 'project-1' as never,
      name: 'coding-guard',
      spec: {
        path: '/tmp/factory/.edictum/workflow-profile.yaml',
        description: 'Fresh factory guarded workflow profile',
      },
    })

    const result = await requestJson(fixture.app, '/api/factory-settings')
    const catalogs = result.json as FactorySettingsCatalogs
    const codingGuard = catalogs.workflows.filter((workflow) => workflow.workflowId === 'coding-guard')

    expect(result.response.status).toBe(200)
    expect(codingGuard).toEqual([
      expect.objectContaining({
        id: 'workflow-seeded',
        source: 'saved',
        presetId: 'coding-guard',
        path: '/tmp/factory/.edictum/workflow-profile.yaml',
      }),
    ])
  })

  it('rejects invalid resource-backed Agent compatibility before save', async () => {
    fixture = await createFixture()
    seedModelAndHarness(fixture, 'openai', 'gpt-5.4', 'claude-agent-sdk')

    const result = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad-agent', resourceRefs: { modelRef: 'model', harnessRef: 'harness' } },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toMatchObject({
      error: expect.stringContaining('provider model ID gpt-5.4 is not supported by Harness adapter type claude-agent-sdk'),
    })
    expect(fixture.repos.agents.getByName('bad-agent')).toBeNull()
  })

  it('rejects provider model ID drift before save', async () => {
    fixture = await createFixture()
    seedModelAndHarness(fixture, 'openai', 'claude-sonnet-4-6', 'claude-agent-sdk')

    const result = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad-provider', resourceRefs: { modelRef: 'model', harnessRef: 'harness' } },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toMatchObject({
      error: expect.stringContaining('provider ID openai does not match provider model ID claude-sonnet-4-6'),
    })
    expect(fixture.repos.agents.getByName('bad-provider')).toBeNull()
  })

})

function seedFactorySettings(fixture: TestFixture): void {
  fixture.repos.factory.create({
    id: 'factory-1' as never,
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  seedModelAndHarness(fixture, 'openai', 'gpt-5.4', 'codex-sdk')
  fixture.repos.configResources.create({
    id: 'sandbox-1' as never,
    kind: 'SandboxProfile',
    projectId: null,
    name: 'builder-worktree',
    spec: { provider: 'host', mode: 'worktree' },
  })
  fixture.repos.configResources.create({
    id: 'notification-1' as never,
    kind: 'NotificationChannel',
    projectId: null,
    name: 'telegram-operator',
    spec: { backend: 'telegram', config: { enabled: false } },
  })
  fixture.repos.agents.create({
    id: 'agent-1' as never,
    name: 'codex',
    model: 'gpt-5.4',
    harness: 'codex-sdk',
    resourceRefs: { modelRef: 'gpt-5-4', harnessRef: 'codex-sdk', sandboxRef: 'builder-worktree' },
    capabilities: ['build', 'test', 'fix'],
    effort: 'xhigh',
    costTier: 90,
    spawnConfig: {},
  })
}

function seedModelAndHarness(
  fixture: TestFixture,
  provider: string,
  providerModelId: string,
  harnessType: string,
): void {
  fixture.repos.configResources.create({
    id: 'model' as never,
    kind: 'Model',
    projectId: null,
    name: 'gpt-5-4',
    spec: { provider, modelId: providerModelId, supportedEfforts: ['high', 'xhigh'] },
  })
  fixture.repos.configResources.create({
    id: 'harness' as never,
    kind: 'Harness',
    projectId: null,
    name: 'codex-sdk',
    spec: { type: harnessType },
  })
}
