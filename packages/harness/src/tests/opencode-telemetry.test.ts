import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenCodeHarnessAdapter } from '../opencode.js'
import { createAgent, createRun, createTask, jsonResponse } from './helpers.js'

describe('OpenCode harness telemetry contract', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('http://opencode.test/session?') && init?.method === 'POST') {
        return jsonResponse({ id: 'opencode-session-1', title: 'session' })
      }
      if (url.startsWith('http://opencode.test/mcp?') && init?.method === 'POST') {
        return jsonResponse({ ok: true })
      }
      if (url.includes('/prompt_async?') && init?.method === 'POST') {
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('http://opencode.test/session/status?')) {
        return jsonResponse({ 'opencode-session-1': { type: 'busy' } })
      }
      if (url.includes('/disconnect?') && init?.method === 'POST') {
        return jsonResponse(true)
      }
      if (url.includes('/session/opencode-session-1?') && init?.method === 'DELETE') {
        return jsonResponse(true)
      }
      if (url.includes('/message?')) {
        return jsonResponse([])
      }
      return jsonResponse({ ok: true })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records the provider session id on spawn', async () => {
    const adapter = new OpenCodeHarnessAdapter('http://ductum.test', 'http://opencode.test')
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never, {
      agent: createAgent({ spawnConfig: { workingDir: '/tmp/opencode' } }),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/harness-session-id',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ harnessSessionId: 'opencode-session-1' }),
      }),
    )
    await adapter.kill(session.sessionId)
  })
})
