import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('dispatcher readiness API behavior', () => {
  it('fails manual dispatch loudly when the API has no dispatch callback', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)

    const result = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toEqual({ error: 'Dispatch is not available — server started without --dispatch' })
  })

  it('preserves dispatcher disabled reasons in runtime status output', async () => {
    fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: 3,
        lastCycleAt: null,
        enabled: false,
        adapterCount: 0,
        adapters: [],
        reason: 'dispatch disabled: server started without --dispatch',
      }),
    })

    const result = await requestJson(fixture.app, '/api/factory/dispatcher')

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      enabled: false,
      reason: 'dispatch disabled: server started without --dispatch',
    })
  })

  it('keeps adapter-load dispatch failures operator-visible', async () => {
    fixture = await createFixture({
      dispatchTask: vi.fn(() => {
        throw new Error('Dispatch not available — dispatch disabled: harness adapters failed to load')
      }),
    })
    const { task, builder } = seedBase(fixture)

    const result = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })

    expect(result.response.status).toBe(500)
    expect(result.json).toEqual({
      error: 'Dispatch not available — dispatch disabled: harness adapters failed to load',
    })
  })
})
