import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type Run } from '@ductum/core'

import { parseTelegramConfig } from '../lib/telegram.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'
import { execFileAsync, setupMergeFixture } from './routes/shared.js'

describe('NotificationChannel operator visibility', () => {
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

  it('returns a structured webhook response for broken channel refs instead of a generic 500', async () => {
    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'secret' },
      body: { callback_query: { id: 'cb-1', data: 'ductum:approve:run-1' } },
    })

    expect(response.response.status).toBe(503)
    expect(response.json).toMatchObject({ ok: false, error: 'telegram misconfigured' })
    expect(String(response.text)).not.toContain('ops')
  })

  it('approves callbacks through a resource-resolved Telegram webhook config', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    createFactoryChannel({ botToken: '123:test', chatId: '456', webhookSecret: 'secret' })
    const mergeFix = await setupMergeFixture()
    try {
      const commitSha = (await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])).stdout.trim()
      const run = createPendingApprovalRun({ branch: 'feature/x', commitSha, worktreePaths: [mergeFix.worktree] })
      const response = await requestJson(fixture.app, '/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'secret' },
        body: { callback_query: { id: 'cb-1', data: `ductum:approve:${run.id}`, message: { message_id: 1, chat: { id: 456 } } } },
      })
      expect(response.response.status).toBe(200)
      expect(response.json).toMatchObject({ ok: true, runId: run.id, action: 'approve' })
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'done', pendingApproval: false })
    } finally {
      await mergeFix.cleanup()
    }
  })

  it('reports disabled resource-backed webhooks without calling Telegram', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    createFactoryChannel({ enabled: false })

    const response = await requestJson(fixture.app, '/api/telegram/webhook', { method: 'POST', body: {} })

    expect(response.response.status).toBe(404)
    expect(response.json).toMatchObject({ ok: false, error: 'telegram disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects resource-backed webhook callbacks with the wrong secret', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    createFactoryChannel({ botToken: '123:test', chatId: '456', webhookSecret: 'secret' })

    const response = await requestJson(fixture.app, '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: { callback_query: { id: 'cb-1', data: 'ductum:approve:run-1' } },
    })

    expect(response.response.status).toBe(403)
    expect(response.json).toMatchObject({ ok: false, error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports ambiguous channel refs through status', async () => {
    createProjectChannel('other-a')
    createProjectChannel('other-b')

    const status = await requestJson(fixture.app, '/api/telegram/status')

    expect(status.json).toMatchObject({ enabled: false, error: 'telegram.channelRef "ops" is ambiguous' })
  })

  it('rejects project-scoped channel refs by name and id', async () => {
    const channel = createProjectChannel('project-only')

    const byName = await requestJson(fixture.app, '/api/telegram/status')
    fixture.context.telegram.channelRef = channel.id
    const byId = await requestJson(fixture.app, '/api/telegram/status')

    expect(byName.json).toMatchObject({ error: expect.stringContaining('project-scoped NotificationChannel') })
    expect(byId.json).toMatchObject({ error: expect.stringContaining('project-scoped NotificationChannel') })
  })

  it('surfaces disabled and broken channel states in the factory summary', async () => {
    createFactoryChannel({ enabled: false })
    const disabled = await requestJson(fixture.app, '/api/factory/operator-brief')
    fixture.repos.configResources.delete(fixture.repos.configResources.getByName('NotificationChannel', 'ops')!.id)
    const missing = await requestJson(fixture.app, '/api/factory/operator-brief')
    createFactoryChannel({ botToken: '123:test', webhookSecret: 'secret' })
    const malformed = await requestJson(fixture.app, '/api/factory/operator-brief')

    expect(disabled.json).toMatchObject({ telegram: { channelRef: 'ops', skipped: 'disabled' } })
    expect(missing.json).toMatchObject({ telegram: { channelRef: 'ops', error: 'Notification channel not found: ops' } })
    expect(malformed.json).toMatchObject({ telegram: { channelRef: 'ops', error: expect.stringContaining('chatId') } })
    expect((missing.json as { recommendedActions: string[] }).recommendedActions)
      .toContain('Fix Telegram notification channel ops: Notification channel not found: ops.')
  })

  it('rejects unsupported channel backends loudly', async () => {
    createFactoryChannel({}, 'slack')

    const status = await requestJson(fixture.app, '/api/telegram/status')

    expect(status.json).toMatchObject({ enabled: false, error: 'NotificationChannel ops has backend "slack"; expected telegram' })
  })

  it('keeps env channelRef config from carrying legacy credentials as fallback', () => {
    const parsed = parseTelegramConfig(JSON.stringify({
      channelRef: 'ops',
      botToken: 'legacy-token',
      chatId: 'legacy-chat',
      webhookSecret: 'legacy-secret',
    }))

    expect(parsed).toEqual({
      enabled: false,
      channelRef: 'ops',
      configError: 'DUCTUM_TELEGRAM_CONFIG cannot combine channelRef with botToken, chatId, webhookSecret',
    })
    expect(parseTelegramConfig(JSON.stringify({ channelRef: 'ops', enabled: true }))).toEqual({
      enabled: false,
      channelRef: 'ops',
      configError: 'DUCTUM_TELEGRAM_CONFIG cannot combine channelRef with enabled',
    })
    expect(parseTelegramConfig(JSON.stringify({ channelRef: 'ops', publicBaseUrl: 'https://factory.test' }))).toEqual({
      enabled: false,
      channelRef: 'ops',
      configError: 'DUCTUM_TELEGRAM_CONFIG cannot combine channelRef with publicBaseUrl',
    })
  })

  function createFactoryChannel(config: Record<string, unknown>, backend = 'telegram') {
    return fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: null,
      name: 'ops',
      spec: { backend: backend as never, config },
    })
  }

  function createPendingApprovalRun(fields: Partial<Run> = {}): Run {
    const run = fixture.repos.runs.create({
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
    return run
  }

  function createProjectChannel(name: string) {
    const project = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: seeded.factory.id,
      name,
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    return fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: project.id,
      name: 'ops',
      spec: { backend: 'telegram', config: { enabled: false } },
    })
  }
})
