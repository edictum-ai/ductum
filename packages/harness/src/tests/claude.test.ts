import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '@ductum/mcp'

import { ClaudeHarnessAdapter } from '../claude.js'
import { buildClaudeSystemPrompt } from '../prompts/claude-system.js'
import { MockClaudeQuery, createAgent, createRun, createTask, jsonResponse } from './helpers.js'

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn<(prompt: string, options: object) => MockClaudeQuery>(),
}))
const CONTROL_TOKEN = 'token-1'

vi.mock('../sdk.js', () => ({
  startClaudeQuery: queryMock,
  buildClaudeMcpServers: (name: string) => ({ [name]: { type: 'sdk', name } }),
  CLAUDE_BYPASS_PERMISSION_MODE: 'bypassPermissions',
}))

function createAdapter() {
  return new ClaudeHarnessAdapter('http://ductum.test')
}

function createBoundMcpServer() {
  return createMcpServer('http://ductum.test', 'run-1' as ReturnType<typeof createRun>['id'])
}

function mockAgentFetch(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/agents/agent-1')) {
      return jsonResponse(createAgent())
    }
    if (url.endsWith('/api/runs/run-1/tokens') && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    if (url.endsWith('/api/runs/run-1/heartbeat') && init?.method === 'POST') {
      return jsonResponse({ ok: true })
    }
    return jsonResponse({})
  })
}

describe('ClaudeHarnessAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    queryMock.mockReset()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('blocks tool calls when authorize-tool rejects them', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)
    fetchMock.mockImplementationOnce(async () => jsonResponse(createAgent()))
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/agents/agent-1')) {
        return jsonResponse(createAgent())
      }
      if (
        url.endsWith('/api/internal/authorize-tool') &&
        init?.method === 'POST' &&
        (init.headers as Record<string, string> | undefined)?.['x-ductum-control-token'] === CONTROL_TOKEN
      ) {
        return jsonResponse({ error: 'git push is blocked in implementing' }, 403)
      }
      return jsonResponse({})
    })

    const session = await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN },
    )
    const options = queryMock.mock.calls[0]?.[1] as {
      hooks: { PreToolUse: Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }> }
    }
    const hook = options.hooks.PreToolUse[0]?.hooks[0]
    const result = await hook?.({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push' },
      tool_use_id: 'tool-1',
    })

    expect(session.sessionId).toBe('session-1')
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'git push is blocked in implementing',
      },
    })
  })

  it('allows tool calls when authorize-tool approves them', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/agents/agent-1')) {
        return jsonResponse(createAgent())
      }
      if (
        url.endsWith('/api/internal/authorize-tool') &&
        init?.method === 'POST' &&
        (init.headers as Record<string, string> | undefined)?.['x-ductum-control-token'] === CONTROL_TOKEN
      ) {
        return jsonResponse({ allowed: true })
      }
      return jsonResponse({})
    })

    await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN },
    )
    const options = queryMock.mock.calls[0]?.[1] as {
      hooks: { PreToolUse: Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }> }
    }
    const hook = options.hooks.PreToolUse[0]?.hooks[0]

    await expect(
      hook?.({
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: 'packages/harness/src/claude.ts' },
        tool_use_id: 'tool-2',
      }),
    ).resolves.toEqual({})
  })

  it('launches Claude with isolated settings and only Ductum MCP', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN },
    )
    const options = queryMock.mock.calls[0]?.[1] as {
      settingSources?: string[]
      skills?: string[] | 'all'
      strictMcpConfig?: boolean
      mcpServers?: Record<string, unknown>
    }

    expect(options.settingSources).toEqual([])
    expect(options.skills).toEqual([])
    expect(options.strictMcpConfig).toBe(true)
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['ductum'])
  })

  it('passes dispatcher resource caps into Claude SDK options', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN, maxTurns: 7, maxBudgetUsd: 3 },
    )
    const options = queryMock.mock.calls[0]?.[1] as {
      maxTurns?: number
      maxBudgetUsd?: number
    }

    expect(options.maxTurns).toBe(7)
    expect(options.maxBudgetUsd).toBe(3)
  })

  it('omits Claude SDK maxTurns when the dispatcher does not provide a cap', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN, maxBudgetUsd: 3 },
    )
    const options = queryMock.mock.calls[0]?.[1] as {
      maxTurns?: number
      maxBudgetUsd?: number
    }

    expect(options).not.toHaveProperty('maxTurns')
    expect(options.maxBudgetUsd).toBe(3)
  })

  it('fires heartbeat updates on the interval', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { controlToken: CONTROL_TOKEN },
    )
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-ductum-control-token': CONTROL_TOKEN }),
      }),
    )
  })

  it('tracks token deltas from result messages', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0.1,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            usage: { input_tokens: 14, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0.15,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))

    expect(tokenCalls).toHaveLength(2)
    expect(JSON.parse(String(tokenCalls[0]?.[1]?.body))).toEqual({ tokensIn: 10, tokensOut: 5, costUsd: 0.1 })
    expect(JSON.parse(String(tokenCalls[1]?.[1]?.body))).toEqual({ tokensIn: 4, tokensOut: 3, costUsd: 0.05 })
    expect(result).toMatchObject({ exitReason: 'completed', tokensIn: 14, tokensOut: 8, costUsd: 0.15 })
  })

  it('tracks token usage from intermediate assistant messages', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] },
          },
        },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: { usage: { input_tokens: 200, output_tokens: 80 }, content: [] },
          },
        },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            usage: { input_tokens: 300, output_tokens: 130, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0.05,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))

    // 2 assistant message posts + 1 result delta post = 3 total
    expect(tokenCalls).toHaveLength(3)
    // First assistant turn: 100 in, 50 out — no cache fields on this
    // fixture, so cached/creation are 0.
    expect(JSON.parse(String(tokenCalls[0]?.[1]?.body))).toEqual({
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0,
      cachedTokensIn: 0,
      cacheCreationTokensIn: 0,
    })
    // Second assistant turn: 200 in, 80 out
    expect(JSON.parse(String(tokenCalls[1]?.[1]?.body))).toEqual({
      tokensIn: 200,
      tokensOut: 80,
      costUsd: 0,
      cachedTokensIn: 0,
      cacheCreationTokensIn: 0,
    })
    // Result delta: cumulative (300,130) - accumulated (300,130) = (0,0) but cost 0.05
    // Since tokens delta is 0, only cost is relevant; recordUsage posts if cost > 0
    expect(JSON.parse(String(tokenCalls[2]?.[1]?.body))).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0.05 })
    // Final snapshot should reflect the cumulative totals from result
    expect(result).toMatchObject({ exitReason: 'completed', tokensIn: 300, tokensOut: 130, costUsd: 0.05 })
  })

  it('forwards cache_read and cache_creation tokens as gross + split fields', async () => {
    // Anthropic reports input_tokens as UNCACHED only. The harness
    // should sum uncached + cache_read + cache_creation into tokensIn
    // (gross) and pass cached/creation through as separate fields so
    // the API's cache-aware pricing has the full picture.
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: {
              usage: {
                input_tokens: 40,
                output_tokens: 20,
                cache_read_input_tokens: 150,
                cache_creation_input_tokens: 10,
              },
              content: [],
            },
          },
        },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            usage: {
              input_tokens: 40,
              output_tokens: 20,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 150,
            },
            total_cost_usd: 0.02,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))

    // Per-assistant delta: gross = 40 + 150 + 10 = 200, cached = 150,
    // cacheCreation = 10.
    expect(JSON.parse(String(tokenCalls[0]?.[1]?.body))).toEqual({
      tokensIn: 200,
      tokensOut: 20,
      costUsd: 0,
      cachedTokensIn: 150,
      cacheCreationTokensIn: 10,
    })
    // Final snapshot gross totals match the intermediate accumulation.
    expect(result).toMatchObject({ exitReason: 'completed', tokensIn: 200, tokensOut: 20 })
  })

  it('does not create session mappings and returns the SDK session id', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0.01,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())

    expect(session.sessionId).toBe('session-1')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('session_run_mapping'))).toBe(false)
  })

  it('classifies silent prompt-overflow completions as failed', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: {
              usage: { input_tokens: 10, output_tokens: 0 },
              content: [{ type: 'text', text: 'Prompt is too long. Please reduce the input.' }],
            },
          },
        },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            result: '',
            usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()

    expect(result).toMatchObject({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
      },
    })
  })

  it('classifies prompt-overflow result text as failed', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            result: 'Prompt is too long',
            usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0.01,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()

    expect(result).toMatchObject({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: false,
        source: 'result',
      },
    })
  })

  it('classifies SDK prompt-overflow stream errors as failed', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: {
              usage: { input_tokens: 10, output_tokens: 0 },
              content: [{ type: 'text', text: 'Prompt is too long' }],
            },
          },
        },
        { type: 'error', error: new Error('Claude Code returned an error result: Prompt is too long') },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const result = await session.waitForCompletion()

    expect(result).toMatchObject({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: false,
        source: 'error',
      },
    })
  })

  it('classifies silent mid-write max-turn completions as failed with suggested actions', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        {
          type: 'message',
          value: {
            type: 'assistant',
            session_id: 'session-1',
            message: {
              usage: { input_tokens: 20, output_tokens: 0 },
              content: [{ type: 'text', text: 'Maximum turns reached while editing files.' }],
            },
          },
        },
        {
          type: 'message',
          value: {
            type: 'result',
            subtype: 'success',
            session_id: 'session-1',
            result: '',
            usage: { input_tokens: 20, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            total_cost_usd: 0,
            is_error: false,
            terminal_reason: 'completed',
          },
        },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(
      createRun(),
      createTask(),
      'system prompt',
      createBoundMcpServer(),
      { maxTurns: 200 },
    )
    const result = await session.waitForCompletion()

    expect(result).toMatchObject({
      exitReason: 'failed',
      failReason: 'max_turns_reached',
      failureEvidence: {
        kind: 'claude-agent-sdk.max_turns_reached',
        reason: 'max_turns_reached',
        signature: 'Maximum turns',
        resultTextEmpty: true,
        currentLimit: 200,
        suggestedLimit: 300,
        suggestedActions: [
          { kind: 'bump_max_turns', args: { currentLimit: 200, suggestedLimit: 300 } },
          { kind: 'retry_same_agent' },
          { kind: 'switch_agent', args: { candidateAgents: [] } },
        ],
      },
    })
  })

  it('builds a system prompt without exposing the run id', () => {
    const prompt = buildClaudeSystemPrompt(createTask())

    expect(prompt).toContain('Implement the Claude harness adapter.')
    expect(prompt).not.toContain('run-1')
    expect(prompt).not.toContain('run_id')
    expect(prompt).not.toContain('runId')
  })

  it('kill stops heartbeats and marks the session as killed', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())

    await adapter.kill(session.sessionId)
    await vi.advanceTimersByTimeAsync(60_000)

    const result = await session.waitForCompletion()
    const heartbeatCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/heartbeat'))
    expect(result.exitReason).toBe('killed')
    expect(await adapter.isAlive(session.sessionId)).toBe(false)
    expect(heartbeatCalls).toHaveLength(0)
  })

  it('reaps Claude SDK spawned worker processes on kill', async () => {
    vi.useRealTimers()
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'hang' },
      ]),
    )
    mockAgentFetch(fetchMock)

    const adapter = createAdapter()
    const session = await adapter.spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())
    const options = queryMock.mock.calls[0]?.[1] as {
      spawnClaudeCodeProcess: (spawnOptions: {
        command: string
        args: string[]
        cwd: string
        env: NodeJS.ProcessEnv
        signal: AbortSignal
      }) => ChildProcess
    }
    const abort = new AbortController()
    const child = options.spawnClaudeCodeProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env: process.env,
      signal: abort.signal,
    })

    try {
      expect(child.pid).toEqual(expect.any(Number))
      await adapter.kill(session.sessionId)
      await waitForChildExit(child)
      expect(child.signalCode).toBe('SIGTERM')
      expect(await adapter.isAlive(session.sessionId)).toBe(false)
    } finally {
      abort.abort()
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    }
  })

  it('reports crashed sessions when the SDK stream throws', async () => {
    queryMock.mockReturnValue(
      new MockClaudeQuery([
        { type: 'message', value: { type: 'system', subtype: 'init', session_id: 'session-1' } },
        { type: 'error', error: new Error('sdk crashed') },
      ]),
    )
    mockAgentFetch(fetchMock)

    const session = await createAdapter().spawn(createRun(), createTask(), 'system prompt', createBoundMcpServer())

    await expect(session.waitForCompletion()).resolves.toMatchObject({ exitReason: 'crashed' })
  })
})

async function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return
  await Promise.race([
    once(child, 'exit'),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for Claude child exit')), 2_000)
    }),
  ])
}
