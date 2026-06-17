import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DuctumPlugin } from '../plugin/index.js'
import { DUCTUM_HEALTH_PROBE_AGENT, DUCTUM_HEALTH_PROBE_TOOL } from '../opencode-probe.js'
import { jsonResponse } from './helpers.js'

describe('Ductum OpenCode plugin', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const controlToken = 'token-1'

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DUCTUM_CONTROL_TOKEN', controlToken)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('allows tool calls when Ductum approves them', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ allowed: true }))

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(hook?.({ tool: 'read', sessionID: 'session-1' }, { args: { filePath: 'foo.ts' } })).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('http://localhost:4100/api/internal/authorize-tool')
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        session_id: 'session-1',
        tool: 'read',
        args: { filePath: 'foo.ts' },
      }),
      headers: {
        'content-type': 'application/json',
        'x-ductum-control-token': controlToken,
      },
    })
  })

  it('blocks tool calls with the Ductum reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ allowed: false, reason: 'git push is blocked' }))

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(hook?.({ tool: 'bash', sessionID: 'session-1' }, { args: { command: 'git push' } })).rejects.toThrow(
      'git push is blocked',
    )
  })

  it('fails closed when the Ductum API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(hook?.({ tool: 'bash', sessionID: 'session-1' }, { args: { command: 'git status' } })).rejects.toThrow(
      'Ductum enforcement unavailable - tool call blocked for safety',
    )
  })

  it('blocks unknown sessions', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reason: 'Unknown session' }, 404))

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(hook?.({ tool: 'read', sessionID: 'missing' }, { args: { filePath: 'foo.ts' } })).rejects.toThrow(
      'Unknown session',
    )
  })

  it('rewrites health probes to the synthetic Ductum tool and target session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ allowed: true }))

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(
      hook?.(
        { tool: 'task', sessionID: 'probe-session' },
        {
          args: {
            prompt: DUCTUM_HEALTH_PROBE_TOOL,
            description: 'target-session',
            subagent_type: DUCTUM_HEALTH_PROBE_AGENT,
          },
        },
      ),
    ).rejects.toThrow('Ductum plugin health probe completed')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('http://localhost:4100/api/internal/authorize-tool')
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        session_id: 'target-session',
        tool: DUCTUM_HEALTH_PROBE_TOOL,
        args: {},
      }),
      headers: {
        'content-type': 'application/json',
        'x-ductum-control-token': controlToken,
      },
    })
  })

  it('fails closed when the control token is missing', async () => {
    vi.stubEnv('DUCTUM_CONTROL_TOKEN', '')

    const hook = (await DuctumPlugin())['tool.execute.before']
    await expect(hook?.({ tool: 'read', sessionID: 'session-1' }, { args: { filePath: 'foo.ts' } })).rejects.toThrow(
      'Ductum control token missing - tool call blocked for safety',
    )
  })
})
