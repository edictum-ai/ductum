import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Factory runtime P4 current-vs-desired config', () => {
  it('reports current and desired runtime settings with restart markers', async () => {
    fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: true,
        activeRuns: 0,
        maxConcurrentRuns: 3,
        lastCycleAt: null,
        enabled: true,
        adapterCount: 1,
        adapters: ['codex-sdk'],
        reason: null,
      }),
      getRuntimeConfig: () => ({ heartbeatTimeoutSeconds: 120, pollIntervalMs: 30_000 }),
      runtime: {
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
        publicApiUrl: null,
        dashboardUrl: 'http://127.0.0.1:4100',
        dbPath: '/tmp/factory/ductum.db',
        factoryDataDir: '/tmp/factory',
        worktreeEnabled: true,
        worktreeBasePath: '/tmp/factory/.ductum/worktrees',
      },
    })
    const { factory } = seedBase(fixture)
    fixture.repos.runtimeSettings.upsert(factory.id, {
      apiBindHost: '127.0.0.1',
      apiPort: 4100,
      dispatcherEnabled: true,
      dispatcherHeartbeatIntervalSeconds: 30,
      worktreeEnabled: true,
      worktreeBasePath: '/tmp/factory/.ductum/worktrees',
    })

    const afterRead = await requestJson(fixture.app, '/api/factory/runtime')
    expect(afterRead.response.status).toBe(200)
    expect(afterRead.json).toMatchObject({
      current: expect.objectContaining({
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
        dispatcherRunning: true,
        dispatcherEnabled: true,
        dispatcherHeartbeatIntervalSeconds: 30,
        dbPath: '/tmp/factory/ductum.db',
        factoryDataDir: '/tmp/factory',
      }),
      desired: expect.objectContaining({
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
        dispatcherEnabled: true,
        dispatcherHeartbeatIntervalSeconds: 30,
        heartbeatTimeoutSeconds: 120,
      }),
      restartRequired: false,
      affectedRuntimes: [],
    })

    const patched = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      body: {
        apiBindHost: '0.0.0.0',
        apiPort: 4777,
        publicApiUrl: 'https://factory.example.test',
      },
    })

    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: false,
      restartRequired: true,
      affectedRuntimes: ['api', 'notifications'],
      current: expect.objectContaining({ apiBindHost: '127.0.0.1', apiPort: 4100 }),
      desired: expect.objectContaining({
        apiBindHost: '0.0.0.0',
        apiPort: 4777,
        publicApiUrl: 'https://factory.example.test',
      }),
    })
    expect(fixture.repos.runtimeSettings.get(factory.id)?.apiPort).toBe(4777)

    const noRestart = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      body: { dispatcherHeartbeatIntervalSeconds: 30 },
    })
    expect(noRestart.json).toMatchObject({
      applied: true,
      restartRequired: false,
      affectedRuntimes: [],
    })

    const rejected = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      body: { dbPath: '/tmp/other.sqlite' },
    })
    expect(rejected.response.status).toBe(400)
    expect(rejected.json).toMatchObject({
      error: expect.stringContaining('Factory Runtime fields are not supported: dbPath'),
    })

    const read = await requestJson(fixture.app, '/api/factory/runtime')
    expect(read.response.status).toBe(200)
    expect(read.json).toMatchObject({
      current: expect.objectContaining({ apiPort: 4100 }),
      desired: expect.objectContaining({ apiPort: 4777 }),
      restartRequired: true,
      affectedRuntimes: expect.arrayContaining(['api']),
    })
  })

  it('hot-applies heartbeat timeout when dispatcher runtime support is wired', async () => {
    let heartbeatTimeoutSeconds = 120
    fixture = await createFixture({
      getRuntimeConfig: () => ({ heartbeatTimeoutSeconds, pollIntervalMs: 10_000 }),
      setHeartbeatTimeoutSeconds: (seconds) => {
        heartbeatTimeoutSeconds = seconds
      },
      runtime: { heartbeatTimeoutSeconds },
    })
    seedBase(fixture)

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { heartbeatTimeoutSeconds: 240 },
    })
    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: true,
      restartRequired: false,
      affectedRuntimes: [],
      current: expect.objectContaining({ heartbeatTimeoutSeconds: 240 }),
      desired: expect.objectContaining({ heartbeatTimeoutSeconds: 240 }),
    })

    const runtime = await requestJson(fixture.app, '/api/factory/runtime')
    expect(runtime.json).toMatchObject({
      current: expect.objectContaining({ heartbeatTimeoutSeconds: 240 }),
      desired: expect.objectContaining({ heartbeatTimeoutSeconds: 240 }),
      restartRequired: false,
    })
  })
})
