import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitHarnessEvent } from '../canonical-events.js'
import { jsonResponse } from './helpers.js'

describe('canonical harness events', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const runId = 'run-1' as never

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records harness session ids explicitly on session.started', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'session.started',
      harnessSessionId: 'claude-session-1',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/harness-session-id',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ harnessSessionId: 'claude-session-1' }),
      }),
    )
  })

  it('ignores blank harness session ids on session.started', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'session.started',
      harnessSessionId: '',
    })
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'session.started',
      harnessSessionId: '   ',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records text deltas as text activity', async () => {
    await emitHarnessEvent('http://ductum.test', runId, { type: 'text.delta', content: 'Reading README.md' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST', body: JSON.stringify({ kind: 'text', content: 'Reading README.md' }),
      }),
    )
  })

  it('records tool requests as tool_call activity', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.requested', toolName: 'Read', args: { file_path: 'README.md' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'tool_call', content: JSON.stringify({ file_path: 'README.md' }), toolName: 'Read' }),
      }),
    )
  })

  it('treats tool.allowed as a no-op event', async () => {
    await emitHarnessEvent('http://ductum.test', runId, { type: 'tool.allowed', toolName: 'Read' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records tool results and explicit workflow evidence without inferring success', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'README.md' },
      content: 'README contents',
      success: true,
    })

    expect(fetchMock.mock.calls).toEqual([
      [
        'http://ductum.test/api/runs/run-1/activity',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            kind: 'tool_result',
            content: 'README contents',
            toolName: 'Read',
          }),
        }),
      ],
      [
        'http://ductum.test/api/runs/run-1/tool-success',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            tool: 'Read',
            args: { file_path: 'README.md' },
          }),
        }),
      ],
    ])
  })

  it('does not record tool success unless success is explicitly true', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'README.md' },
      content: 'first',
    })
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.result',
      toolName: 'Read',
      args: { file_path: 'README.md' },
      content: 'second',
      success: false,
    })

    const toolSuccessCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tool-success'))
    expect(toolSuccessCalls).toHaveLength(0)
  })

  it('skips tool success when tool metadata is incomplete', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.result',
      args: { file_path: 'README.md' },
      success: true,
    })
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.result',
      toolName: 'Read',
      content: 'README contents',
      success: true,
    })

    const toolSuccessCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tool-success'))
    expect(toolSuccessCalls).toHaveLength(0)
  })

  it('records blocked tools as explicit blocked activity', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.blocked',
      toolName: 'Bash',
      args: { command: 'git push' },
      content: 'git push',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'tool_call',
          content: 'BLOCKED: git push',
          toolName: 'Bash',
        }),
      }),
    )
  })

  it('surfaces tool.blocked reason in activity content', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.blocked',
      toolName: 'McpElicitation',
      args: { serverName: 'ductum_run_abc', message: 'Proceed?' },
      reason: 'Ductum runs are non-interactive; MCP elicitation declined',
    })

    const call = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(call[0]).toBe('http://ductum.test/api/runs/run-1/activity')
    const body = JSON.parse(call[1].body) as { kind: string; content: string; toolName: string }
    expect(body.kind).toBe('tool_call')
    expect(body.toolName).toBe('McpElicitation')
    expect(body.content).toContain('BLOCKED:')
    expect(body.content).toContain('Ductum runs are non-interactive; MCP elicitation declined')
  })

  it('surfaces tool.blocked reason with MCP server name and elicitation message', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'tool.blocked',
      toolName: 'McpElicitation',
      args: { serverName: 'ductum_run_xyz', message: 'Allow deploy?' },
      content: 'ductum_run_xyz: Allow deploy?',
      reason: 'Ductum runs are non-interactive; MCP elicitation declined',
    })

    const call = fetchMock.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(call[1].body) as { content: string }
    expect(body.content).toContain('ductum_run_xyz')
    expect(body.content).toContain('Allow deploy?')
    expect(body.content).toContain('MCP elicitation declined')
  })

  it('posts token deltas for cost.updated', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'cost.updated',
      usage: { tokensIn: 12, tokensOut: 7, costUsd: 0.02, cachedTokensIn: 3 },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/tokens',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tokensIn: 12,
          tokensOut: 7,
          costUsd: 0.02,
          cachedTokensIn: 3,
        }),
      }),
    )
  })

  it('posts heartbeats explicitly', async () => {
    await emitHarnessEvent('http://ductum.test', runId, { type: 'heartbeat' }, 'token-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-ductum-control-token': 'token-1' }),
        body: JSON.stringify({}),
      }),
    )
  })

  it('records approval requests as summary activity', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'needs_approval',
      toolName: 'Bash',
      args: { command: 'git push' },
      content: 'git push',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'summary',
          content: 'approval requested: Bash git push',
          toolName: 'Bash',
        }),
      }),
    )
  })

  it('records completed events with a default message', async () => {
    await emitHarnessEvent('http://ductum.test', runId, { type: 'completed' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'result',
          content: 'Turn completed',
        }),
      }),
    )
  })

  it('records failed events as result activity', async () => {
    await emitHarnessEvent('http://ductum.test', runId, {
      type: 'failed',
      content: 'session crashed',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'result',
          content: 'session crashed',
        }),
      }),
    )
  })
})
