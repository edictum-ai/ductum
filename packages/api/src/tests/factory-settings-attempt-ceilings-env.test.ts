import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Factory Settings attempt ceiling env overrides', () => {
  it('does not report restart-required runtimes when env attempt ceilings override settings', async () => {
    fixture = await createFixture({
      getRuntimeConfig: () => ({
        heartbeatTimeoutSeconds: 120,
        attemptCeilings: { maxCumulativeCostUsd: 20 },
        attemptCeilingsSource: 'env',
      }),
    })
    seedBase(fixture)

    const patched = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      body: { attemptCeilings: { maxCumulativeCostUsd: 80 } },
    })

    expect(patched.response.status).toBe(200)
    expect(patched.json).toMatchObject({
      applied: true,
      restartRequired: false,
      affectedRuntimes: [],
      desired: expect.objectContaining({
        attemptCeilings: expect.objectContaining({ maxCumulativeCostUsd: 80 }),
      }),
    })
    expect(fixture.repos.factory.get()?.config.attemptCeilings).toEqual({ maxCumulativeCostUsd: 80 })
  })
})
