import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type Run } from '@ductum/core'

import { TelegramApprovalNotifier } from '../lib/telegram.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('NotificationChannel runtime backing', () => {
  let fixture: TestFixture
  let seeded: ReturnType<typeof seedBase>

  beforeEach(async () => {
    fixture = await createFixture({ operatorToken: 'missing', telegram: { enabled: false, channelRef: 'ops' } })
    seeded = seedBase(fixture)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fixture.close()
  })

  it('resolves a telegram channel resource to the existing approval send path', async () => {
    const fetchMock = stubTelegramOk()
    const channel = createTelegramChannel()
    const run = createPendingApprovalRun({ branch: 'feature/channels', commitSha: 'abcdef1234567890' })

    const result = await new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id)

    expect(result.status).toBe('sent')
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/bot123:test/sendMessage')
    const body = requestBody(fetchMock)
    expect(body.text).toContain('Ductum approval requested')
    expect(body.text).toContain('feature/channels')
    expect(body.parse_mode).toBe('HTML')
    expect(body.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(`ductum:approve:${run.id}`)
    expect(notificationEvidence(run.id)).toEqual({
      kind: 'notification.delivery',
      backend: 'telegram',
      event: 'approval.requested',
      status: 'sent',
      source: 'resource',
      channelRef: 'ops',
      channelId: channel.id,
      channelName: 'ops',
      commitSha: 'abcdef1234567890',
    })
  })

  it('skips disabled channel resources visibly without calling Telegram', async () => {
    const fetchMock = stubTelegramOk()
    createTelegramChannel({ config: { enabled: false } })
    const run = createPendingApprovalRun()

    const result = await new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id)
    const status = await requestJson(fixture.app, '/api/telegram/status')

    expect(result).toMatchObject({ status: 'skipped', reason: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(notificationEvidence(run.id)).toMatchObject({ status: 'skipped', reason: 'disabled' })
      expect(status.json).toMatchObject({ enabled: false, configured: false, skipped: 'disabled', webhookUrl: null })
  })

  it('fails missing channel refs loudly without falling back to legacy credentials', async () => {
    fixture.context.telegram = {
      enabled: true,
      botToken: 'legacy-token',
      chatId: 'legacy-chat',
      webhookSecret: 'legacy-secret',
      channelRef: 'ops',
    }
    const fetchMock = stubTelegramOk()
    const run = createPendingApprovalRun()

    await expect(new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id))
      .rejects.toThrow('Notification channel not found: ops')
    const status = await requestJson(fixture.app, '/api/telegram/status')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      source: 'resource',
      error: 'Notification channel not found: ops',
    })
    expect(status.json).toMatchObject({
      enabled: false,
      channelRef: 'ops',
      error: 'Notification channel not found: ops',
    })
  })

  it('fails wrong-kind channel refs loudly', async () => {
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'Model',
      projectId: null,
      name: 'ops',
      spec: { provider: 'openai', modelId: 'gpt-5.4' },
    })
    const run = createPendingApprovalRun()

    await expect(new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id))
      .rejects.toThrow('references Model, expected NotificationChannel')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('references Model'),
    })
  })

  it('fails malformed telegram channel resources loudly', async () => {
    createTelegramChannel({ config: { botToken: '123:test', webhookSecret: 'secret' } })
    const run = createPendingApprovalRun()

    await expect(new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id))
      .rejects.toThrow('telegram config missing: chatId')
    const status = await requestJson(fixture.app, '/api/telegram/status')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('chatId'),
    })
    expect(status.json).toMatchObject({ enabled: false, error: expect.stringContaining('chatId') })
  })

  it('preserves legacy telegram config when no channel resource is configured', async () => {
    fixture.context.telegram = {
      enabled: true,
      botToken: '123:legacy',
      chatId: '456',
      webhookSecret: 'secret',
      publicBaseUrl: 'https://factory.example.test',
    }
    const fetchMock = stubTelegramOk()
    const run = createPendingApprovalRun({ branch: 'feature/legacy' })

    await new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id)

    expect(fetchMock.mock.calls.length).toBe(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/bot123:legacy/sendMessage')
    expect(requestBody(fetchMock).text).toContain('feature/legacy')
    expect(notificationEvidence(run.id)).toBeUndefined()
  })

  it('sends approval notifications through the backend interface', async () => {
    const fetchMock = stubTelegramOk()
    createTelegramChannel()
    const run = createPendingApprovalRun()

    const result = await new TelegramApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    expect(result.status).toBe('sent')
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it('handles approval actions through the backend interface', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    createTelegramChannel()
    const run = createPendingApprovalRun()

    const result = await new TelegramApprovalNotifier(fixture.context).handleAction({
      action: 'approve',
      runId: run.id,
      actor: 'telegram:ops',
      callbackQueryId: 'cb-1',
      chatId: 456,
      messageId: 1,
    })

    expect(result).toEqual({ ok: true, runId: run.id, action: 'approve' })
    expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'done', pendingApproval: false })
  })

  it('rejects backend actions from the wrong Telegram chat loudly', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    createTelegramChannel()
    const run = createPendingApprovalRun()

    const result = await new TelegramApprovalNotifier(fixture.context).handleAction({
      action: 'approve',
      runId: run.id,
      actor: 'telegram:ops',
      callbackQueryId: 'cb-1',
      chatId: 999,
      messageId: 1,
    })

    expect(result).toMatchObject({ ok: false, runId: run.id, action: 'approve', error: 'forbidden chat', statusCode: 403 })
    expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'ship', pendingApproval: true })
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/answerCallbackQuery')
  })

  it('records send failures instead of leaving them logs-only', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 })))
    createTelegramChannel()
    const run = createPendingApprovalRun()

    await expect(new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id))
      .rejects.toThrow('Telegram sendMessage failed: 500 nope')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      error: 'Telegram sendMessage failed: 500 nope',
    })
  })

  it('records legacy send failures instead of leaving them logs-only', async () => {
    fixture.context.telegram = {
      enabled: true,
      botToken: '123:legacy',
      chatId: '456',
      webhookSecret: 'secret',
    }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 })))
    const run = createPendingApprovalRun()

    await expect(new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id))
      .rejects.toThrow('Telegram sendMessage failed: 500 nope')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      source: 'legacy',
      error: 'Telegram sendMessage failed: 500 nope',
    })
  })

  function createTelegramChannel(overrides: { config?: Record<string, unknown> } = {}) {
    return fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: null,
      name: 'ops',
      spec: {
        backend: 'telegram',
        config: overrides.config ?? {
          botToken: '123:test',
          chatId: '456',
          webhookSecret: 'secret',
          publicBaseUrl: 'https://factory.example.test',
        },
      },
    })
  }

  function createPendingApprovalRun(fields: Partial<Run> = {}): Run {
    return fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: seeded.task.id,
      agentId: seeded.builder.id,
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
      ...fields,
    })
  }

  function notificationEvidence(runId: Run['id']) {
    return fixture.repos.evidence
      .list(runId)
      .map((evidence) => evidence.payload)
      .find((payload) => payload.kind === 'notification.delivery')
  }
})

function stubTelegramOk() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: ReturnType<typeof stubTelegramOk>) {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    text: string
    parse_mode: string
    reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> }
  }
}
