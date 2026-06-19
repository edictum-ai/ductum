import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMockApi, runCommand } from './helpers.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard pair command', () => {
  it('prints a one-time pairing link without exposing the operator token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      data: {
        handoffToken: 'pair_secret',
        expiresAt: '2026-06-19T12:00:00.000Z',
        ttlSeconds: 60,
        welcomePath: '/welcome',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runCommand(
      ['--api-url', 'https://factory.example', 'dashboard', 'pair', '--json'],
      createMockApi(),
      '',
      { env: { DUCTUM_OPERATOR_TOKEN: 'operator_secret', PATH: '/bin' } },
    )

    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.text) as { kind: string; data: Record<string, unknown> }
    expect(envelope.kind).toBe('dashboard.pairing_created')
    expect(envelope.data).toMatchObject({
      dashboardUrl: 'https://factory.example/welcome',
      pairingUrl: 'https://factory.example/welcome?pair=pair_secret',
      expiresAt: '2026-06-19T12:00:00.000Z',
      ttlSeconds: 60,
    })
    expect(result.text).not.toContain('operator_secret')
    expect(fetchMock).toHaveBeenCalledWith('https://factory.example/api/welcome/handoff', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ductum-operator-token': 'operator_secret',
      },
      body: '{}',
    })
  })
})

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}
