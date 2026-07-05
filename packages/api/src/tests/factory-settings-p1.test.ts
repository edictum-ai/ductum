import { afterEach, describe, expect, it } from 'vitest'

import { requestJson, seedBase, type TestFixture, createFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Factory Settings P1 typed API foundation', () => {
  it('reads and writes Factory settings with explicit write-result shape', async () => {
    fixture = await createFixture({ costBudget: { perRunHardUsd: 25 } })
    seedBase(fixture)

    const read = await requestJson(fixture.app, '/api/factory/settings')
    expect(read.response.status).toBe(200)
    expect(read.json).toMatchObject({
      recordType: 'FactorySettings',
      name: 'Ductum',
      defaultMergeMode: 'human',
      heartbeatTimeoutSeconds: 120,
      budgets: expect.objectContaining({ perRunHardUsd: 25 }),
      attemptCeilings: expect.objectContaining({
        recordType: 'AttemptCeilings',
        enabled: true,
        maxInputTokensPerTurn: 2_000_000,
        maxCumulativeCostUsd: 100,
        maxTurns: 200,
        configSource: 'default',
      }),
    })

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { name: 'Factory One', defaultMergeMode: 'auto' },
    })

    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: true,
      restartRequired: false,
      affectedRuntimes: [],
      current: expect.objectContaining({ name: 'Factory One', defaultMergeMode: 'auto' }),
      desired: expect.objectContaining({ name: 'Factory One', defaultMergeMode: 'auto' }),
    })
    expect(fixture.repos.factory.get()?.name).toBe('Factory One')
  })

  it('preserves costBudget on Factory Settings patch and hot-applies budget writes', async () => {
    fixture = await createFixture()
    const { factory } = seedBase(fixture)
    fixture.repos.factory.update(factory.id, {
      config: {
        ...factory.config,
        costBudget: { perSpecHardUsd: 200 },
      },
    })

    const renamed = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { name: 'Budget Factory' },
    })
    expect(renamed.response.status).toBe(200)
    expect(renamed.json).toMatchObject({
      applied: true,
      restartRequired: false,
      desired: expect.objectContaining({
        name: 'Budget Factory',
        budgets: expect.objectContaining({ perSpecHardUsd: 200 }),
      }),
    })
    expect(fixture.repos.factory.get()?.config.costBudget).toEqual({ perSpecHardUsd: 200 })

    const budget = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { budgets: { perRunHardUsd: 50 } },
    })
    expect(budget.response.status).toBe(200)
    expect(budget.json).toMatchObject({
      applied: true,
      restartRequired: false,
      current: expect.objectContaining({
        budgets: expect.objectContaining({ perRunHardUsd: 50, perSpecHardUsd: 200 }),
      }),
      desired: expect.objectContaining({
        budgets: expect.objectContaining({ perRunHardUsd: 50, perSpecHardUsd: 200 }),
      }),
    })
    expect(fixture.repos.factory.get()?.config.costBudget).toEqual({
      perRunHardUsd: 50,
      perSpecHardUsd: 200,
    })
    const liveBudget = await requestJson(fixture.app, '/api/factory/cost-budget')
    expect(liveBudget.json).toMatchObject({ perRunHardUsd: 50, perSpecHardUsd: 200 })
  })

  it('exposes default attempt ceilings and persists explicit opt-out through Factory Settings', async () => {
    fixture = await createFixture()
    seedBase(fixture)

    const read = await requestJson(fixture.app, '/api/factory/settings')
    expect(read.response.status).toBe(200)
    expect(read.json).toMatchObject({
      attemptCeilings: expect.objectContaining({ enabled: true, configSource: 'default' }),
    })

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { attemptCeilings: { enabled: false } },
    })

    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: false,
      restartRequired: true,
      affectedRuntimes: expect.arrayContaining(['dispatcher', 'active_attempts']),
      current: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ enabled: true, configSource: 'default' }),
      }),
      desired: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ enabled: false, configSource: 'disabled' }),
      }),
    })
    expect(fixture.repos.factory.get()?.config.attemptCeilings).toEqual({ enabled: false })

    const runtime = await requestJson(fixture.app, '/api/factory/runtime')
    expect(runtime.json).toMatchObject({
      restartRequired: true,
      affectedRuntimes: expect.arrayContaining(['dispatcher', 'active_attempts']),
      current: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ enabled: true, configSource: 'default' }),
      }),
      desired: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ enabled: false, configSource: 'disabled' }),
      }),
    })
  })

  it('merges partial attempt ceiling patches with saved config', async () => {
    fixture = await createFixture()
    const { factory } = seedBase(fixture)
    fixture.repos.factory.update(factory.id, {
      config: { ...factory.config, attemptCeilings: { maxCumulativeCostUsd: 20 } },
    })

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { attemptCeilings: { maxTurns: 300 } },
    })

    expect(patched.response.status).toBe(200)
    expect(fixture.repos.factory.get()?.config.attemptCeilings).toEqual({
      maxCumulativeCostUsd: 20,
      maxTurns: 300,
    })
    expect(patched.json).toMatchObject({
      desired: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ maxCumulativeCostUsd: 20, maxTurns: 300 }),
      }),
    })
  })

  it('keeps restart-required heartbeat writes explicit when no live setter is available', async () => {
    fixture = await createFixture()
    seedBase(fixture)

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { heartbeatTimeoutSeconds: 240 },
    })

    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: false,
      restartRequired: true,
      affectedRuntimes: ['dispatcher'],
      current: expect.objectContaining({ heartbeatTimeoutSeconds: 120 }),
      desired: expect.objectContaining({ heartbeatTimeoutSeconds: 240 }),
    })
    expect(fixture.repos.factory.get()?.config.heartbeatTimeoutSeconds).toBe(240)
  })

  it('exposes typed catalog routes over existing catalog storage', async () => {
    fixture = await createFixture()
    seedBase(fixture)
    fixture.repos.configResources.create({
      id: 'model-1' as never,
      kind: 'Model',
      projectId: null,
      name: 'gpt-5-4',
      spec: {
        provider: 'openai',
        modelId: 'gpt-5.4',
        supportedEfforts: ['high', 'xhigh'],
      },
    })

    const models = await requestJson(fixture.app, '/api/factory/models')
    expect(models.response.status).toBe(200)
    expect(models.json).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordType: 'Model',
        modelId: 'gpt-5-4',
        providerId: 'openai',
        providerModelId: 'gpt-5.4',
        source: 'saved',
      }),
      expect.objectContaining({
        catalogSource: 'live-registry',
        source: 'built-in',
      }),
    ]))

    const created = await requestJson(fixture.app, '/api/factory/models', {
      method: 'POST',
      body: {
        name: 'gpt-5-4',
        providerId: 'openai',
        providerModelId: 'gpt-5.4',
        supportedEfforts: ['high', 'xhigh'],
      },
    })

    expect(created.response.status).toBe(501)
    expect(created.json).toMatchObject({
      error: expect.stringContaining('Factory catalog writes are not implemented in P1'),
    })

    const patched = await requestJson(fixture.app, '/api/factory/models/model-1', {
      method: 'PATCH',
      body: { providerModelId: 'gpt-5.4-2026-06-01' },
    })
    expect(patched.response.status).toBe(501)
    expect(patched.json).toMatchObject({
      error: expect.stringContaining('Factory catalog writes are not implemented in P1'),
    })

    const providers = await requestJson(fixture.app, '/api/factory/providers')
    expect(providers.response.status).toBe(200)
    expect(providers.json).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordType: 'Provider', providerId: 'openai' }),
    ]))

    const providerWrite = await requestJson(fixture.app, '/api/factory/providers', {
      method: 'POST',
      body: { providerId: 'openai' },
    })
    expect(providerWrite.response.status).toBe(501)
    expect(providerWrite.json).toMatchObject({
      error: expect.stringContaining('Provider writes are not implemented in P1'),
    })
  })

  it('returns only secret metadata', async () => {
    fixture = await createFixture()
    seedBase(fixture)
    fixture.repos.secrets.create({
      id: 'secret-1',
      name: 'github-token',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: { type: 'local-file', keyId: 'local-key-1' },
      payload: { algorithm: 'aes-256-gcm', ciphertext: 'secret-ciphertext', nonce: 'nonce', authTag: null },
      lastRotatedAt: null,
      lastTestedAt: null,
    })

    const read = await requestJson(fixture.app, '/api/factory/secrets')
    expect(read.response.status).toBe(200)
    expect(read.text).not.toContain('secret-ciphertext')
    expect(read.text).not.toContain('local-key-1')
    expect(read.json).toEqual([
      expect.objectContaining({ name: 'github-token', status: 'configured', scope: 'factory' }),
    ])
    const secret = (read.json as Array<Record<string, unknown>>)[0]
    expect(Object.keys(secret ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastRotatedAt',
      'lastTestedAt',
      'name',
      'scope',
      'status',
      'updatedAt',
    ])

    const detail = await requestJson(fixture.app, '/api/factory/secrets/secret-1')
    expect(detail.response.status).toBe(200)
    expect(detail.text).not.toContain('secret-ciphertext')
    expect(detail.text).not.toContain('local-key-1')
    expect(detail.json).toMatchObject({ name: 'github-token', status: 'configured', scope: 'factory' })
  })
})
