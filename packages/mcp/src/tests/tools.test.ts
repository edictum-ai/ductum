import { MCP_AGENT_TOOL_CONTRACT, type RunId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DuctumApiError } from '../api-client.js'
import { createMcpServer, getMcpConfigFromEnv } from '../index.js'
import { connectHarness, createContext, createMockApi, createRun, firstText, task } from './helpers.js'

const connections: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.allSettled(connections.splice(0).map((item) => item.close()))
  vi.restoreAllMocks()
})

describe('Ductum MCP tools', () => {
  it('registers all agent-visible tools with no internal tools', async () => {
    const { client } = await connectHarness(createMockApi(), connections)

    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).sort()

    expect(names).toHaveLength(12)
    expect(names).toEqual([
      'ductum.accept',
      'ductum.complete',
      'ductum.decide',
      'ductum.evidence',
      'ductum.fail',
      'ductum.gate_check',
      'ductum.get_context',
      'ductum.heartbeat',
      'ductum.link',
      'ductum.next_task',
      'ductum.update',
      'ductum.workflow',
    ])
    expect(MCP_AGENT_TOOL_CONTRACT.map((tool) => tool.name).sort()).toEqual(names)
    expect(names).not.toContain('ductum.reset')
    expect(names).not.toContain('authorize_tool')

    const toolsWithRunId = tools
      .filter((t) => {
        const schema = t.inputSchema as { properties?: Record<string, unknown> }
        return schema.properties && 'run_id' in schema.properties
      })
      .map((t) => t.name)
      .sort()
    expect(toolsWithRunId).toEqual([])
  })

  it('returns the next task and handles an empty queue', async () => {
    const first = await connectHarness(createMockApi(), connections)
    const next = await first.client.callTool({ name: 'ductum.next_task', arguments: {} })
    expect(next.isError).toBeUndefined()
    expect(next.structuredContent).toMatchObject({ available: true, task: { id: task.id } })

    const second = await connectHarness(createMockApi({ nextTask: vi.fn().mockResolvedValue(null) }), connections)
    const empty = await second.client.callTool({ name: 'ductum.next_task', arguments: {} })
    expect(empty.isError).toBeUndefined()
    expect(empty.structuredContent).toMatchObject({ available: false, task: null })
  })

  it('accept binds the server and returns the task prompt', async () => {
    const api = createMockApi()
    const { client } = await connectHarness(api, connections)

    const accepted = await client.callTool({ name: 'ductum.accept', arguments: { task_id: task.id } })
    expect(accepted.isError).toBeUndefined()
    expect(accepted.structuredContent).toMatchObject({
      boundRunId: 'run-1',
      prompt: task.prompt,
      run: { id: 'run-1' },
      task: { id: task.id },
    })

    // The ductum.complete input schema now requires a summary of at
    // least 50 chars (Priority 4 — handoff-guard-style per-call
    // validation). Tests must send a realistic summary so zod accepts
    // the call and the handler actually runs.
    const longSummary = 'Implemented the fix — added missing null check in loader, rewrote sort predicate, and wired retry logic.'
    await client.callTool({ name: 'ductum.complete', arguments: { result: longSummary } })
    expect(api.complete).toHaveBeenCalledWith('run-1', longSummary)
  })

  it('returns error content when a bound-run tool is called while unbound', async () => {
    const { client } = await connectHarness(createMockApi(), connections)

    const result = await client.callTool({ name: 'ductum.update', arguments: { message: 'still working' } })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('No run is currently bound')
  })

  it('completes on a pre-bound server and rejects run_id args from the agent (D22)', async () => {
    // Decision D22: the agent never sees the run id. Both Claude/GLM
    // and Codex bind the run on the server side (in-process for
    // Claude, URL path for Codex via HTTP MCP). Any run_id arg sent
    // by the agent must be silently ignored — the bound id always wins.
    const api = createMockApi()
    const { client, server } = await connectHarness(api, connections, 'run-prebound' as RunId)

    expect(server.getBoundRunId()).toBe('run-prebound')

    // Priority 4: ductum.complete now requires a summary of at least
    // 50 chars. Use a realistic summary so validation passes.
    const longSummary = 'Implemented the requested change — added a null check, a fallback, and updated the parser to match.'
    const complete = await client.callTool({ name: 'ductum.complete', arguments: { result: longSummary } })
    expect(complete.isError).toBeUndefined()
    expect(api.complete).toHaveBeenCalledWith('run-prebound', longSummary)

    // Agents must not see or pass run ids. Extra run_id args are
    // rejected by strict public tool schemas instead of being honored.
    const overridden = await client.callTool({
      name: 'ductum.complete',
      arguments: { result: longSummary, run_id: 'run-other' },
    })
    expect(overridden.isError).toBe(true)
    expect(api.complete).toHaveBeenCalledTimes(1)
    expect(server.getBoundRunId()).toBe('run-prebound')
  })

  it('returns workflow state from gate_check with actionable blocked guidance when present', async () => {
    const api = createMockApi({
      gateCheck: vi.fn().mockResolvedValue({
        allowed: true,
        stage: 'understand',
        completedStages: [],
        pendingApproval: false,
        blockedReason: 'Read README.md before editing. To continue, perform a supported local repo read: Read README.md.',
      }),
    })
    const { client } = await connectHarness(api, connections, 'run-1' as RunId)
    const result = await client.callTool({
      name: 'ductum.gate_check',
      arguments: {},
    })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain('Read README.md before editing')
    expect(firstText(result)).not.toContain('cat README.md')
    expect(result.structuredContent).toMatchObject({
      ok: true,
      stage: 'understand',
      completedStages: [],
      pendingApproval: false,
      blockedReason: expect.stringContaining('supported local repo read'),
    })
  })

  it('distinguishes recoverable and terminal failures', async () => {
    const recoverableApi = createMockApi({
      fail: vi.fn().mockResolvedValue(createRun('implement')),
    })
    const recoverableHarness = await connectHarness(recoverableApi, connections, 'run-1' as RunId)
    const recoverable = await recoverableHarness.client.callTool({
      name: 'ductum.fail',
      arguments: { reason: 'tests failed', recoverable: true },
    })
    expect(recoverable.isError).toBeUndefined()
    expect(firstText(recoverable)).toContain('Recoverable failure recorded')
    expect(firstText(recoverable)).toContain('reset to implement')

    const terminalApi = createMockApi({
      fail: vi.fn().mockResolvedValue(createRun('implement', 'run-1', { terminalState: 'failed' })),
    })
    const terminalHarness = await connectHarness(terminalApi, connections, 'run-1' as RunId)
    const terminal = await terminalHarness.client.callTool({
      name: 'ductum.fail',
      arguments: { reason: 'cannot continue', recoverable: false },
    })
    expect(terminal.isError).toBeUndefined()
    expect(firstText(terminal)).toContain('failed')
  })

  it('records evidence and links git artifacts', async () => {
    const api = createMockApi()
    const { client } = await connectHarness(api, connections, 'run-1' as RunId)

    const evidence = await client.callTool({
      name: 'ductum.evidence',
      arguments: { type: 'test', payload: { command: 'pnpm test' } },
    })
    expect(evidence.isError).toBeUndefined()
    expect(evidence.structuredContent).toMatchObject({ evidence: { id: 'evidence-1' } })

    const link = await client.callTool({
      name: 'ductum.link',
      arguments: { branch: 'feat/p5-mcp', commit: 'abc123', pr: '42' },
    })
    expect(link.isError).toBeUndefined()
    expect(api.link).toHaveBeenCalledWith('run-1', {
      branch: 'feat/p5-mcp',
      commit: 'abc123',
      pr: '42',
    })
  })

  it('binds from get_context and resumes with the recovered run', async () => {
    const api = createMockApi({
      getContext: vi.fn().mockResolvedValue(createContext('implement', 'stalled')),
    })
    const { client } = await connectHarness(api, connections)

    const context = await client.callTool({ name: 'ductum.get_context', arguments: { task_id: task.id } })
    expect(context.isError).toBeUndefined()
    expect(context.structuredContent).toMatchObject({ boundRunId: 'run-1', context: { run: { stage: 'implement', terminalState: 'stalled' } } })

    await client.callTool({ name: 'ductum.heartbeat', arguments: {} })
    expect(api.heartbeat).toHaveBeenCalledWith('run-1')
  })

  it('preserves an existing run binding when get_context inspects another task', async () => {
    const candidateContext = createContext('implement', null)
    candidateContext.run = createRun('implement', 'candidate-run')
    const api = createMockApi({
      getContext: vi.fn().mockResolvedValue(candidateContext),
    })
    const { client, server } = await connectHarness(api, connections, 'review-run' as RunId)

    const context = await client.callTool({ name: 'ductum.get_context', arguments: { task_id: task.id } })

    expect(context.isError).toBeUndefined()
    expect(firstText(context)).toContain('current MCP session remains bound to review-run')
    expect(context.structuredContent).toMatchObject({
      boundRunId: 'review-run',
      context: { run: { id: 'candidate-run' } },
    })
    expect(server.getBoundRunId()).toBe('review-run')

    const longSummary = 'Reviewed candidate context and completed the current review run without changing bindings.'
    await client.callTool({ name: 'ductum.complete', arguments: { result: longSummary } })
    expect(api.complete).toHaveBeenCalledWith('review-run', longSummary)
  })

  it('returns error content for validation and API failures', async () => {
    const validationHarness = await connectHarness(createMockApi(), connections)
    const missingParam = await validationHarness.client.callTool({ name: 'ductum.accept', arguments: {} })
    expect(missingParam.isError).toBe(true)
    expect(firstText(missingParam)).toContain('task_id')

    const errorHarness = await connectHarness(
      createMockApi({
        nextTask: vi.fn().mockRejectedValue(new DuctumApiError('Backend exploded', 500, { retry: false })),
      }),
      connections,
    )
    const apiError = await errorHarness.client.callTool({ name: 'ductum.next_task', arguments: {} })
    expect(apiError.isError).toBe(true)
    expect(apiError.structuredContent).toMatchObject({
      error: 'Backend exploded',
      status: 500,
      details: { retry: false },
    })
  })

  it('reads config from env for stdio startup', () => {
    expect(createMcpServer('http://localhost:4100', 'run-factory' as RunId).getBoundRunId()).toBe('run-factory')
    expect(getMcpConfigFromEnv({})).toEqual({
      apiUrl: 'http://localhost:4100',
      preBindRunId: undefined,
    })
    expect(
      getMcpConfigFromEnv({
        DUCTUM_API_URL: 'http://localhost:9999',
        DUCTUM_RUN_ID: 'run-env',
      }),
    ).toEqual({
      apiUrl: 'http://localhost:9999',
      preBindRunId: 'run-env',
    })
  })
})
