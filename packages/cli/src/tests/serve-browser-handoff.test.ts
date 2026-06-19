import { describe, expect, it, vi } from 'vitest'

import { createStartBrowserHandoff } from '../serve/browser-handoff.js'

describe('start browser handoff', () => {
  it('mints a short-lived welcome URL without exposing the operator token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      data: {
        handoffToken: 'handoff_secret',
        expiresAt: '2026-06-19T12:00:00.000Z',
        ttlSeconds: 60,
        welcomePath: '/welcome',
      },
    }))

    const handoff = await createStartBrowserHandoff({
      apiUrl: 'http://127.0.0.1:4100',
      operatorToken: 'operator_secret',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(handoff).toEqual({
      dashboardUrl: 'http://127.0.0.1:4100/welcome',
      handoffUrl: 'http://127.0.0.1:4100/welcome?pair=handoff_secret',
      expiresAt: '2026-06-19T12:00:00.000Z',
      ttlSeconds: 60,
    })
    expect(handoff.handoffUrl).not.toContain('operator_secret')
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4100/api/welcome/handoff', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ductum-operator-token': 'operator_secret',
      },
      body: '{}',
    })
  })

  it('redacts the API body from handoff failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: 'operator_secret' }, 500))

    let error: unknown
    try {
      await createStartBrowserHandoff({
        apiUrl: 'http://127.0.0.1:4100',
        operatorToken: 'operator_secret',
        fetch: fetchMock as unknown as typeof fetch,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('API POST /api/welcome/handoff failed with 500')
    expect((error as Error).message).not.toContain('operator_secret')
  })

  it('rejects non-local welcome paths from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      data: {
        handoffToken: 'handoff_secret',
        expiresAt: '2026-06-19T12:00:00.000Z',
        ttlSeconds: 60,
        welcomePath: 'https://example.test/welcome',
      },
    }))

    await expect(createStartBrowserHandoff({
      apiUrl: 'http://127.0.0.1:4100',
      operatorToken: 'operator_secret',
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow('non-local welcome path')
  })
})

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}
