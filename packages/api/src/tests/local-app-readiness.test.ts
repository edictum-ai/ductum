import { describe, expect, it, vi } from 'vitest'

import { probeLocalAppReadiness, unprobedLocalAppStatus } from '../lib/local-app-readiness.js'

describe('local app readiness probe', () => {
  it('reports ready when local /api/health succeeds with the expected payload', async () => {
    const status = await probeLocalAppReadiness({
      runtime: { apiPort: 4100 },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, operatorTokenProtected: true }),
      }),
    })

    expect(status).toEqual({ state: 'ready', label: 'API reachable on 127.0.0.1:4100' })
  })

  it('reports missing when the local app probe target is unavailable', async () => {
    const status = await probeLocalAppReadiness({
      runtime: {},
      env: {},
    })

    expect(status).toMatchObject({
      state: 'missing',
      label: '(missing)',
    })
    expect(status.detail).toContain('no local API port or loopback base URL is configured')
  })

  it('reports missing when the local app is unreachable, times out, or responds with invalid health JSON', async () => {
    const unreachable = await probeLocalAppReadiness({
      runtime: { apiPort: 4100 },
      fetchImpl: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    })
    const timeout = await probeLocalAppReadiness({
      runtime: { apiPort: 4100 },
      fetchImpl: vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    })
    const invalid = await probeLocalAppReadiness({
      runtime: { apiPort: 4100 },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: 'yes' }),
      }),
    })

    expect(unreachable).toMatchObject({
      state: 'missing',
      label: 'API reachable on 127.0.0.1:4100',
      detail: 'Local app health check failed because the API was unreachable.',
    })
    expect(timeout).toMatchObject({
      state: 'missing',
      detail: 'Local app health check timed out after 500ms.',
    })
    expect(invalid).toMatchObject({
      state: 'missing',
      detail: 'Local app health check returned an invalid response payload.',
    })
  })

  it('keeps non-probed code paths explicitly not_checked instead of always ready', () => {
    expect(unprobedLocalAppStatus({ apiPort: 4100 })).toEqual({
      state: 'not_checked',
      label: 'API reachable on 127.0.0.1:4100',
      detail: 'Local app readiness was not checked in this code path.',
    })
  })
})
