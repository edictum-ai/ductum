import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenCodeHarnessAdapter } from '../opencode.js'
import { buildDuctumMcpToolIds } from '../opencode-probe.js'
import { createAgent, createRun, createTask, jsonResponse } from './helpers.js'

function createAdapter() {
  return new OpenCodeHarnessAdapter('http://ductum.test', 'http://opencode.test')
}

describe('OpenCodeHarnessAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('spawn creates an OpenCode session and returns the session id', async () => {
    const { calls, mcpBodies } = installOpenCodeFetch(fetchMock)
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never, {
      controlToken: 'token-1',
    })

    expect(session.sessionId).toBe('session-1')
    expect(calls.some((url) => url.includes('session_run_mapping'))).toBe(false)
    expect(calls).toContain('http://opencode.test/session?directory=%2Ftmp%2Fopencode')
    expect(mcpBodies[0]?.config?.environment?.DUCTUM_CONTROL_TOKEN).toBe('token-1')
    await adapter.kill(session.sessionId)
  })

  it('kill terminates the session', async () => {
    const { calls } = installOpenCodeFetch(fetchMock)
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    await adapter.kill(session.sessionId)

    expect(calls).toContain('http://opencode.test/session/session-1?directory=%2Ftmp%2Fopencode')
  })

  it('heartbeat sends a Ductum heartbeat without plugin probe', async () => {
    installOpenCodeFetch(fetchMock, { pluginProbeSeen: true })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    await vi.advanceTimersByTimeAsync(30_000)
    await adapter.kill(session.sessionId)

    // Heartbeat should be sent (plugin probe is disabled — just heartbeat)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/heartbeat',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does not kill session when probe is skipped', async () => {
    const { deletedSessions } = installOpenCodeFetch(fetchMock, { pluginProbeSeen: false })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    // Heartbeat fires but no probe check — session stays alive
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await adapter.isAlive(session.sessionId)).toBe(true)
    await adapter.kill(session.sessionId)
  })

  it('tracks usage from OpenCode session messages on completion', async () => {
    installOpenCodeFetch(fetchMock, { completeAfterStatusChecks: 1 })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    await vi.advanceTimersByTimeAsync(1_000)
    const result = await session.waitForCompletion()

    expect(result).toMatchObject({ exitReason: 'completed', tokensIn: 7, tokensOut: 3, costUsd: 0.42 })
  })

  it('posts activity entries for text and tool_call parts', async () => {
    const messagesWithParts = [
      {
        info: { role: 'assistant', cost: 0.1, tokens: { input: 5, output: 2 } },
        parts: [
          { type: 'text', text: 'Analyzing the code...' },
          { type: 'tool-invocation', toolInvocation: { toolName: 'Bash', args: { command: 'ls -la' }, state: 'completed' } },
        ],
      },
    ]
    installOpenCodeFetch(fetchMock, { completeAfterStatusChecks: 1, messages: messagesWithParts })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    await vi.advanceTimersByTimeAsync(1_000)
    await session.waitForCompletion()

    const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/activity'))
    const bodies = activityCalls.map(([, init]) => JSON.parse(String(init?.body)))

    // Should have text + tool_call + result activity entries
    expect(bodies.some((b: { kind: string }) => b.kind === 'text')).toBe(true)
    expect(bodies.some((b: { kind: string }) => b.kind === 'tool_call')).toBe(true)
    expect(bodies.some((b: { kind: string }) => b.kind === 'result')).toBe(true)

    // Verify tool call has the correct tool name
    const toolCallBody = bodies.find((b: { kind: string }) => b.kind === 'tool_call')
    expect(toolCallBody?.toolName).toBe('Bash')
  })

  it('posts intermediate token deltas during the run (not just at end)', async () => {
    // Two assistant messages with different token counts — simulate intermediate polling
    const messagesOverTime = [
      [
        { info: { role: 'assistant', cost: 0.1, tokens: { input: 10, output: 5 } }, parts: [{ type: 'text', text: 'Step 1' }] },
      ],
      [
        { info: { role: 'assistant', cost: 0.1, tokens: { input: 10, output: 5 } }, parts: [{ type: 'text', text: 'Step 1' }] },
        { info: { role: 'assistant', cost: 0.2, tokens: { input: 20, output: 10 } }, parts: [{ type: 'text', text: 'Step 2' }] },
      ],
    ]
    installOpenCodeFetch(fetchMock, {
      completeAfterStatusChecks: 7,
      messagesSequence: messagesOverTime,
    })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    // Advance past the first activity poll (tick 3) to get intermediate tokens
    await vi.advanceTimersByTimeAsync(3_000)

    const tokenCallsMidRun = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))
    expect(tokenCallsMidRun.length).toBeGreaterThan(0)

    // Let the session complete
    await vi.advanceTimersByTimeAsync(5_000)
    await session.waitForCompletion()

    // Verify total token calls include intermediate + final
    const allTokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))
    expect(allTokenCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('posts a result activity on completion', async () => {
    installOpenCodeFetch(fetchMock, { completeAfterStatusChecks: 1 })
    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)

    await vi.advanceTimersByTimeAsync(1_000)
    await session.waitForCompletion()

    const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/activity'))
    const bodies = activityCalls.map(([, init]) => JSON.parse(String(init?.body)))
    const resultBody = bodies.find((b: { kind: string }) => b.kind === 'result')
    expect(resultBody).toBeDefined()
    expect(resultBody?.content).toContain('completed')
  })

  it('keeps concurrent sessions isolated with per-session Ductum MCP tool permissions', async () => {
    const { promptBodies } = installOpenCodeFetch(fetchMock, { sessionIds: ['session-1', 'session-2'] })
    const adapter = createAdapter()

    const first = await adapter.spawn(createRun(), createTask(), 'system prompt', {} as never)
    const second = await adapter.spawn(
      createRun({ id: 'run-2' as ReturnType<typeof createRun>['id'] }),
      createTask({ id: 'task-2' as ReturnType<typeof createTask>['id'], prompt: 'Review the diff.' }),
      'review system prompt',
      {} as never,
    )

    expect(promptBodies).toHaveLength(2)
    expect(promptBodies[0]?.tools).toEqual(Object.fromEntries(buildDuctumMcpToolIds('ductum-session-1').map((id) => [id, true])))
    expect(promptBodies[1]?.tools).toEqual({
      ...Object.fromEntries(buildDuctumMcpToolIds('ductum-session-1').map((id) => [id, false])),
      ...Object.fromEntries(buildDuctumMcpToolIds('ductum-session-2').map((id) => [id, true])),
    })
    await adapter.kill(first.sessionId)
    await adapter.kill(second.sessionId)
  })
})

function installOpenCodeFetch(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  options: {
    pluginProbeSeen?: boolean
    completeAfterStatusChecks?: number
    sessionIds?: string[]
    /** Static messages returned for every GET /message call */
    messages?: Array<{ info: Record<string, unknown>; parts: Array<Record<string, unknown>> }>
    /** Sequence of message arrays — each GET /message call shifts the next one */
    messagesSequence?: Array<Array<{ info: Record<string, unknown>; parts: Array<Record<string, unknown>> }>>
  } = {},
) {
  const promptBodies: Array<{ tools?: Record<string, boolean> }> = []
  const mcpBodies: Array<{ config?: { environment?: Record<string, string> } }> = []
  const deletedSessions: string[] = []
  const calls: string[] = []
  const sessionIds = [...(options.sessionIds ?? ['session-1', 'probe-1'])]
  const messagesSequence = options.messagesSequence ? [...options.messagesSequence] : null
  let statusChecks = 0

  const defaultMessages = options.messages ?? [
    { info: { role: 'assistant', cost: 0.42, tokens: { input: 7, output: 3 } }, parts: [] },
  ]

  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push(url)

    if (url === 'http://ductum.test/api/agents/agent-1') {
      return jsonResponse(
        createAgent({
          name: 'codex',
          model: 'openai/gpt-5.4',
          harness: 'vercel-ai',
          spawnConfig: { workingDir: '/tmp/opencode' },
        }),
      )
    }
    if (url === 'http://ductum.test/api/runs/run-1/heartbeat' && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    if (url === 'http://ductum.test/api/runs/run-2/heartbeat' && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    if (url.endsWith('/tokens') && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    if (url.endsWith('/activity') && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    if (url.startsWith('http://ductum.test/api/internal/plugin-probe')) {
      return jsonResponse({ seen: options.pluginProbeSeen ?? true })
    }
    if (url.startsWith('http://opencode.test/session?') && init?.method === 'POST') {
      const sessionId = sessionIds.shift() ?? `session-${sessionIds.length + 1}`
      return jsonResponse({ id: sessionId, title: 'session' })
    }
    if (url.startsWith('http://opencode.test/mcp?') && init?.method === 'POST') {
      mcpBodies.push(JSON.parse(String(init.body)) as { config?: { environment?: Record<string, string> } })
      return jsonResponse({ ok: true })
    }
    if (url.startsWith('http://opencode.test/session/status?')) {
      statusChecks += 1
      return jsonResponse({
        'session-1': { type: statusChecks > (options.completeAfterStatusChecks ?? Number.MAX_SAFE_INTEGER) ? 'idle' : 'busy' },
      })
    }
    if (url.includes('/prompt_async?') && init?.method === 'POST') {
      promptBodies.push(JSON.parse(String(init.body)) as { tools?: Record<string, boolean> })
      return new Response(null, { status: 204 })
    }
    if (url.includes('/message?') && init?.method === 'POST') {
      return jsonResponse({ info: { role: 'assistant' }, parts: [] })
    }
    if (url.includes('/message?') && init?.method == null) {
      // GET messages — return from sequence if available, else static
      if (messagesSequence != null && messagesSequence.length > 0) {
        const next = messagesSequence.shift()!
        // Keep the last entry available for subsequent calls
        if (messagesSequence.length === 0) {
          messagesSequence.push(next)
        }
        return jsonResponse(next)
      }
      return jsonResponse(defaultMessages)
    }
    if (url.includes('/disconnect?') && init?.method === 'POST') {
      return jsonResponse(true)
    }
    if (url.includes('/session/session-1?') && init?.method === 'DELETE') {
      deletedSessions.push('session-1')
      return jsonResponse(true)
    }
    if (url.includes('/session/session-2?') && init?.method === 'DELETE') {
      deletedSessions.push('session-2')
      return jsonResponse(true)
    }
    if (url.includes('/session/probe-1?') && init?.method === 'DELETE') {
      deletedSessions.push('probe-1')
      return jsonResponse(true)
    }

    return jsonResponse({})
  })

  return { calls, promptBodies, deletedSessions, mcpBodies }
}
