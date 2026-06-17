import { afterEach, describe, expect, it, vi } from 'vitest'

import { DuctumApiClient } from '../api-client.js'
import { createRun } from './helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DuctumApiClient.complete', () => {
  it('posts completion and then requests end-session as a fallback teardown', async () => {
    const run = createRun('implement')
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new DuctumApiClient('http://localhost:4100')
    const result = await client.complete(run.id, 'implemented enough detail to satisfy the completion summary minimum')
    expect(result).toEqual(run)

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:4100/api/runs/run-1/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ result: 'implemented enough detail to satisfy the completion summary minimum' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:4100/api/runs/run-1/end-session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  })

  it('ignores end-session failures after completion succeeds', async () => {
    const run = createRun('implement')
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 200 }))
      .mockRejectedValueOnce(new Error('session already gone'))
    vi.stubGlobal('fetch', fetchMock)

    const client = new DuctumApiClient('http://localhost:4100')
    await expect(
      client.complete(run.id, 'implemented enough detail to satisfy the completion summary minimum'),
    ).resolves.toEqual(run)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('DuctumApiClient.endSession', () => {
  it('surfaces direct end-session request failures', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network down')))

    const client = new DuctumApiClient('http://localhost:4100')
    await expect(client.endSession('run-1')).rejects.toThrow('network down')
  })
})
