import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRun, createTask, jsonResponse } from './helpers.js'

const clientState = vi.hoisted(() => ({
  createSession: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    createSession: clientState.createSession,
    start: clientState.start,
    stop: clientState.stop,
  })),
}))

import { approveCopilotPermissionOnce, CopilotSDKHarnessAdapter } from '../copilot-sdk.js'

describe('CopilotSDKHarnessAdapter permissions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/api/agents/')) {
        return jsonResponse({ model: 'gpt-5' })
      }
      if (url.includes('/api/runs/') && url.endsWith('/workflow')) {
        return jsonResponse({ activeStage: 'understand', stages: [] })
      }
      return jsonResponse({})
    }))
    clientState.createSession.mockReset()
    clientState.start.mockReset()
    clientState.stop.mockReset()
    clientState.start.mockResolvedValue(undefined)
    clientState.stop.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns the runtime-accepted approve-once permission result', () => {
    expect(approveCopilotPermissionOnce())
      .toEqual({ kind: 'approve-once' })
  })

  it('passes the approve-once handler into createSession and preserves loud auth/model failures', async () => {
    const createSessionError = new Error('Copilot authentication required for model gpt-5')
    let capturedPermissionHandler: ((...args: unknown[]) => unknown) | undefined
    clientState.createSession.mockImplementation(async (config: { onPermissionRequest: (...args: unknown[]) => unknown }) => {
      capturedPermissionHandler = config.onPermissionRequest
      throw createSessionError
    })

    const adapter = new CopilotSDKHarnessAdapter('http://ductum.test')

    await expect(adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )).rejects.toThrow(createSessionError.message)

    expect(capturedPermissionHandler).toBeTypeOf('function')
    expect(capturedPermissionHandler?.({}, { sessionId: 'copilot-session' })).toEqual({
      kind: 'approve-once',
    })
    expect(clientState.stop).toHaveBeenCalledOnce()
  })

  it('passes only the run-scoped control token in the MCP URL', async () => {
    vi.stubEnv('DUCTUM_OPERATOR_TOKEN', 'operator-secret')
    const createSessionError = new Error('stop after config capture')
    let capturedConfig: { mcpServers?: Record<string, { url?: string }> } | undefined
    clientState.createSession.mockImplementation(async (config: { mcpServers?: Record<string, { url?: string }> }) => {
      capturedConfig = config
      throw createSessionError
    })

    const adapter = new CopilotSDKHarnessAdapter('http://ductum.test')

    await expect(adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run', controlToken: 'run-control-secret' },
    )).rejects.toThrow(createSessionError.message)

    const url = capturedConfig?.mcpServers?.['ductum_run_run-1']?.url
    expect(url).toBe('http://ductum.test/api/mcp/run-1?ductum_control_token=run-control-secret')
    expect(url).not.toContain('ductum_operator_token')
    expect(url).not.toContain('operator-secret')
  })
})
