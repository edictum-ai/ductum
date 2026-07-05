import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - telegram and parity', () => {
  it('POST /api/telegram/webhook approves a pending run through the normal approval path', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    fixture = await createFixture({
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
        webhookSecret: 'secret',
        publicBaseUrl: 'https://factory.example.test',
      },
    })
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
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
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'worktree.snapshot',
        branch: 'feature/noop',
        commitSha: 'noop',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
        timestamp: new Date().toISOString(),
      },
    })

    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'secret' },
      body: {
        callback_query: {
          id: 'cb-1',
          data: `ductum:approve:${run.id}`,
          from: { username: 'arnold' },
          message: { message_id: 10, chat: { id: 456 } },
        },
      },
    })

    expect(response.response.status).toBe(200)
    expect((response.json as { ok: boolean; action: string }).ok).toBe(true)
    expect((response.json as { action: string }).action).toBe('approve')
    const after = fixture.repos.runs.get(run.id)!
    expect(after.stage).toBe('done')
    expect(after.pendingApproval).toBe(false)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('lets Telegram webhook auth bypass operator token auth', async () => {
    fixture = await createFixture({
      operatorToken: 'secret',
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
        webhookSecret: 'telegram-secret',
      },
    })
    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'telegram-secret' },
      body: {},
    })

    expect(response.response.status).toBe(200)
    expect(response.json).toMatchObject({ ok: true, ignored: true })
  })

  it('POST /api/telegram/webhook rejects the wrong Telegram secret', async () => {
    fixture = await createFixture({
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
        webhookSecret: 'secret',
      },
    })
    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: { callback_query: { id: 'cb-1', data: 'ductum:approve:run-1' } },
    })

    expect(response.response.status).toBe(403)
  })

  it('POST /api/telegram/webhook rejects callbacks from another chat', async () => {
    fixture = await createFixture({
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
        webhookSecret: 'secret',
      },
    })
    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'secret' },
      body: {
        callback_query: {
          id: 'cb-1',
          data: 'ductum:approve:run-1',
          message: { message_id: 10, chat: { id: 999 } },
        },
      },
    })

    expect(response.response.status).toBe(403)
  })

  it('POST /api/telegram/webhook stays disabled without a webhook secret', async () => {
    fixture = await createFixture({
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
      },
    })
    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      body: { callback_query: { id: 'cb-1', data: 'ductum:approve:run-1' } },
    })

    expect(response.response.status).toBe(404)
  })

  it('sends a Telegram message when a run enters pending approval', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    fixture = await createFixture({
      telegram: {
        enabled: true,
        botToken: '123:test',
        chatId: '456',
        webhookSecret: 'secret',
        publicBaseUrl: 'https://factory.example.test',
      },
    })
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
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
      branch: 'feature/demo',
      commitSha: 'abcdef1234567890',
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

    fixture.context.events.emit({ type: 'approval.requested', runId: run.id })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    const body = JSON.parse(String(init?.body)) as {
      reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> }
      text: string
    }
    expect(body.text).toContain('Ductum approval requested')
    expect(body.text).toContain('feature/demo')
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(`ductum:approve:${run.id}`)
  })

  it('blocks parity-mode ship runs until PR metadata is linked and external checks pass', async () => {
    const syncExternalWatchers = vi.fn((runId: string) => {
      fixture?.repos.runs.updateLatchStatus(runId as never, 'ciStatus', 'pending')
      fixture?.repos.runs.updateLatchStatus(runId as never, 'reviewStatus', 'pending')
    })
    fixture = await createFixture({ syncExternalWatchers })
    const { task, builder, project } = seedBase(fixture)
    fixture.repos.projects.update(project.id, {
      config: { ...project.config, externalReviewRequired: true },
    })

    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id, sessionId: 'session-parity' },
    })
    const runId = (accept.json as { id: string }).id

    await fixture.context.enforcement.advanceToStage(runId as never, 'ship')

    let run = fixture.repos.runs.get(runId as never)
    expect(run?.pendingApproval).toBe(false)
    expect(run?.blockedReason).toContain('missing branch, commitSha, and prUrl')

    const incompleteLink = await requestJson(fixture.app, `/api/runs/${runId}/link`, {
      method: 'POST',
      body: {
        commitSha: 'abc123',
        prUrl: 'https://github.com/acartag7/ductum/pull/42',
      },
    })
    expect(incompleteLink.response.status).toBe(200)
    expect((incompleteLink.json as { blockedReason: string }).blockedReason).toContain('missing branch')
    expect(syncExternalWatchers).not.toHaveBeenCalled()

    const linked = await requestJson(fixture.app, `/api/runs/${runId}/link`, {
      method: 'POST',
      body: {
        branch: 'feat/parity-loop',
        commitSha: 'abc123',
        prUrl: 'https://github.com/acartag7/ductum/pull/42',
      },
    })
    expect(linked.response.status).toBe(200)
    expect(syncExternalWatchers).toHaveBeenCalledWith(runId)
    expect((linked.json as { pendingApproval: boolean }).pendingApproval).toBe(false)
    expect((linked.json as { blockedReason: string }).blockedReason).toContain(
      'waiting for external CI and external GitHub review',
    )

    const approveBlocked = await requestJson(fixture.app, `/api/runs/${runId}/approve`, {
      method: 'POST',
      body: {},
    })
    expect(approveBlocked.response.status).toBe(400)
    expect(approveBlocked.text).toContain('waiting for external CI and external GitHub review')

    fixture.repos.runs.updateLatchStatus(runId as never, 'ciStatus', 'pass')
    fixture.repos.runs.updateLatchStatus(runId as never, 'reviewStatus', 'pass')
    await fixture.context.enforcement.syncRunState(runId as never)

    run = fixture.repos.runs.get(runId as never)
    expect(run?.pendingApproval).toBe(true)
    expect(run?.blockedReason).toBeNull()
  })
})
