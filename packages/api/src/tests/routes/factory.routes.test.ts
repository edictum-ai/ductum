import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - factory', () => {
  it('returns a disabled dispatcher payload and 409 cycle when dispatcher support is absent', async () => {
    fixture = await createFixture()

    const status = await requestJson(fixture.app, '/api/factory/dispatcher')
    expect(status.response.status).toBe(200)
    expect(status.json).toEqual({
      running: false,
      activeRuns: 0,
      maxConcurrentRuns: 0,
      lastCycleAt: null,
      enabled: false,
      adapterCount: 0,
      adapters: [],
      reason: 'dispatcher support not loaded',
    })

    const cycle = await requestJson(fixture.app, '/api/factory/dispatcher/cycle', { method: 'POST' })
    expect(cycle.response.status).toBe(409)
    expect(cycle.json).toEqual({ error: 'Dispatcher cycle unavailable — dispatcher support not loaded' })
  })

  it('returns dispatcher status and runs one dispatcher cycle when enabled', async () => {
    const dispatcherStatus = {
      running: true,
      activeRuns: 2,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-04-25T00:00:00.000Z',
      enabled: true,
      adapterCount: 2,
      adapters: ['claude-agent-sdk', 'codex-sdk'],
      reason: null,
    }
    const cycleDispatcher = vi.fn().mockResolvedValue({
      tasksEvaluated: 3,
      tasksDispatched: ['task-1', 'task-2'],
      errors: [{ taskId: 'task-3', error: 'No available agent matches task' }],
    })
    fixture = await createFixture({
      getDispatcherStatus: () => dispatcherStatus,
      cycleDispatcher,
    })

    const status = await requestJson(fixture.app, '/api/factory/dispatcher')
    expect(status.response.status).toBe(200)
    expect(status.json).toEqual(dispatcherStatus)

    const cycle = await requestJson(fixture.app, '/api/factory/dispatcher/cycle', { method: 'POST' })
    expect(cycle.response.status).toBe(200)
    expect(cycle.json).toEqual({
      tasksEvaluated: 3,
      tasksDispatched: ['task-1', 'task-2'],
      errors: [{ taskId: 'task-3', error: 'No available agent matches task' }],
    })
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
  })

  it('rejects dispatcher cycle when dispatcher is wired but disabled', async () => {
    const cycleDispatcher = vi.fn().mockResolvedValue({
      tasksEvaluated: 1,
      tasksDispatched: ['task-1'],
      errors: [],
    })
    fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: 3,
        lastCycleAt: null,
        enabled: false,
        adapterCount: 1,
        adapters: ['codex-sdk'],
        reason: 'dispatch disabled by startup config',
      }),
      cycleDispatcher,
    })

    const cycle = await requestJson(fixture.app, '/api/factory/dispatcher/cycle', { method: 'POST' })
    expect(cycle.response.status).toBe(409)
    expect(cycle.json).toEqual({ error: 'Dispatcher cycle unavailable — dispatch disabled by startup config' })
    expect(cycleDispatcher).not.toHaveBeenCalled()
  })

  it('GET /api/factory/operator-brief returns a safe-default factory summary when nothing is wired', async () => {
    fixture = await createFixture({ telegram: { enabled: false } })
    seedBase(fixture)

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as {
      generatedAt: string
      dispatcher: Record<string, unknown>
      queue: Record<string, number>
      telegram: Record<string, unknown>
      agents: Array<{ name: string; model: string; harness: string; effort: string | null; capabilities: string[] }>
      recommendedActions: string[]
    }
    expect(typeof brief.generatedAt).toBe('string')
    expect(brief.dispatcher).toEqual({
      enabled: false,
      running: false,
      activeRuns: 0,
      maxConcurrentRuns: 0,
      lastCycleAt: null,
      adapterCount: 0,
    })
    expect(brief.queue).toEqual({
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks: 1,
      needsOperator: 0,
      integrityIssues: 0,
    })
    expect(brief.telegram).toEqual({ enabled: false, configured: false })
    expect(brief.telegram).not.toHaveProperty('botToken')
    expect(brief.telegram).not.toHaveProperty('chatId')
    expect(brief.telegram).not.toHaveProperty('webhookSecret')
    const agentNames = brief.agents.map((a) => a.name).sort()
    expect(agentNames).toEqual(['codex', 'mimi'])
    for (const agent of brief.agents) {
      expect(typeof agent.model).toBe('string')
      expect(typeof agent.harness).toBe('string')
      expect(Array.isArray(agent.capabilities)).toBe(true)
    }
    expect(brief.recommendedActions.length).toBeGreaterThan(0)
    expect(brief.recommendedActions.some((line) => /ready task/i.test(line))).toBe(true)
    expect(brief.recommendedActions.some((line) => /dispatcher/i.test(line))).toBe(true)
  })

  it('persists Home last-look state through factory view-state routes', async () => {
    fixture = await createFixture({ now: () => new Date('2026-06-16T12:10:00.000Z') })
    const { factory } = seedBase(fixture)

    const empty = await requestJson(fixture.app, '/api/factory/home-view-state')
    expect(empty.response.status).toBe(200)
    expect(empty.json).toEqual({
      factoryId: factory.id,
      homeLastSeenAt: null,
      createdAt: null,
      updatedAt: null,
    })

    const timestamp = '2026-06-16T12:00:00.000Z'
    const updated = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: timestamp },
    })
    expect(updated.response.status).toBe(200)
    expect(updated.json).toMatchObject({ factoryId: factory.id, homeLastSeenAt: timestamp })
    const updatedJson = updated.json as { createdAt: unknown; updatedAt: unknown }
    expect(typeof updatedJson.createdAt).toBe('string')
    expect(typeof updatedJson.updatedAt).toBe('string')

    const readBack = await requestJson(fixture.app, '/api/factory/home-view-state')
    expect(readBack.json).toMatchObject({ factoryId: factory.id, homeLastSeenAt: timestamp })

    const newer = '2026-06-16T12:05:00.000Z'
    const movedForward = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: newer },
    })
    expect(movedForward.json).toMatchObject({ factoryId: factory.id, homeLastSeenAt: newer })

    const staleWrite = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: timestamp },
    })
    expect(staleWrite.json).toMatchObject({ factoryId: factory.id, homeLastSeenAt: newer })

    const nullWrite = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: null },
    })
    expect(nullWrite.json).toMatchObject({ factoryId: factory.id, homeLastSeenAt: newer })
  })

  it('rejects invalid Home last-look timestamps and missing factories', async () => {
    fixture = await createFixture({ now: () => new Date('2026-06-16T12:00:00.000Z') })

    const missing = await requestJson(fixture.app, '/api/factory/home-view-state')
    expect(missing.response.status).toBe(404)

    seedBase(fixture)
    const invalid = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: 'not-a-date' },
    })
    expect(invalid.response.status).toBe(400)
    expect(invalid.json).toEqual({ error: 'homeLastSeenAt must be an ISO timestamp or null' })

    const nullBody = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: null,
    })
    expect(nullBody.response.status).toBe(400)
    expect(nullBody.json).toEqual({ error: 'body must be an object' })

    for (const looseTimestamp of ['2026-06-16', 'June 16 2026', '2026-06-16T12:00:00Z']) {
      const loose = await requestJson(fixture.app, '/api/factory/home-view-state', {
        method: 'PUT',
        body: { homeLastSeenAt: looseTimestamp },
      })
      expect(loose.response.status).toBe(400)
      expect(loose.json).toEqual({ error: 'homeLastSeenAt must be an ISO timestamp or null' })
    }

    const future = await requestJson(fixture.app, '/api/factory/home-view-state', {
      method: 'PUT',
      body: { homeLastSeenAt: '2026-06-16T12:06:00.001Z' },
    })
    expect(future.response.status).toBe(400)
    expect(future.json).toEqual({ error: 'homeLastSeenAt cannot be in the future' })
  })

  it('GET /api/factory/operator-brief summarises dispatcher, activity, agents and redacts telegram secrets', async () => {
    const dispatcherStatus = {
      running: true,
      activeRuns: 2,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-04-25T01:00:00.000Z',
      enabled: true,
      adapterCount: 2,
      adapters: ['claude-agent-sdk', 'codex-sdk'],
      reason: null,
    }
    const secretToken = '123:TELEGRAM-BOT-TOKEN'
    const secretChatId = '987654321'
    const webhookSecret = 'top-secret-webhook'
    fixture = await createFixture({
      getDispatcherStatus: () => dispatcherStatus,
      telegram: {
        enabled: true,
        botToken: secretToken,
        chatId: secretChatId,
        webhookSecret,
        publicBaseUrl: 'https://factory.example.test/',
      },
    })
    const { task, builder } = seedBase(fixture)
    fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as {
      dispatcher: Record<string, unknown>
      queue: Record<string, number>
      telegram: { enabled: boolean; configured: boolean; webhookUrl?: string | null }
      recommendedActions: string[]
    }
    expect(brief.dispatcher).toEqual({
      enabled: true,
      running: true,
      activeRuns: 2,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-04-25T01:00:00.000Z',
      adapterCount: 2,
    })
    expect(brief.queue.approvalsWaiting).toBe(1)
    expect(brief.queue.activeRuns).toBe(0)
    expect(brief.telegram).toEqual({
      enabled: true,
      configured: true,
      webhookUrl: 'https://factory.example.test/api/telegram/webhook',
    })
    expect(brief.recommendedActions.some((line) => /approval/i.test(line))).toBe(true)

    // Secrets must never reach operators/agents via the brief.
    const serialized = response.text
    expect(serialized).not.toContain(secretToken)
    expect(serialized).not.toContain(webhookSecret)
    expect(serialized).not.toContain(secretChatId)
  })
})
