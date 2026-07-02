import { createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type ConfigResourceId, type Run } from '@ductum/core'

import { WebhookApprovalNotifier, WEBHOOK_HEADERS } from '../lib/webhook.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

const SECRET_VALUE = 'test-webhook-shared-secret'

describe('NotificationChannel webhook runtime', () => {
  let fixture: TestFixture
  let seeded: ReturnType<typeof seedBase>
  let oldEnv: string | undefined

  beforeEach(async () => {
    oldEnv = process.env.DUCTUM_TEST_WEBHOOK_SECRET
    process.env.DUCTUM_TEST_WEBHOOK_SECRET = SECRET_VALUE
    fixture = await createFixture({ operatorToken: 'missing', telegram: { enabled: false } })
    seeded = seedBase(fixture)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (oldEnv == null) delete process.env.DUCTUM_TEST_WEBHOOK_SECRET
    else process.env.DUCTUM_TEST_WEBHOOK_SECRET = oldEnv
    fixture.close()
  })

  it('delivers signed approval requests to factory webhook channels', async () => {
    const fetchMock = stubOk()
    const channel = createWebhookChannel()
    const run = createPendingApprovalRun({
      branch: 'feature/webhook',
      commitSha: 'abcdef1234567890',
    })

    const result = await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    expect(result.status).toBe('sent')
    expect(fetchMock.mock.calls.length).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://example.test/hook')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get(WEBHOOK_HEADERS.timestamp)).toMatch(/^\d+$/)
    expect(headers.get(WEBHOOK_HEADERS.signature)).toMatch(/^sha256=[0-9a-f]+$/)

    const body = String(init?.body)
    const parsed = JSON.parse(body) as { event: string; runId: string }
    expect(parsed.event).toBe('approval.requested')
    expect(parsed.runId).toBe(run.id)

    const timestamp = headers.get(WEBHOOK_HEADERS.timestamp)!
    const expected = computeExpectedSignature(timestamp, body)
    expect(headers.get(WEBHOOK_HEADERS.signature)).toBe(`${WEBHOOK_HEADERS.signaturePrefix}${expected}`)

    expect(notificationEvidence(run.id)).toMatchObject({
      kind: 'notification.delivery',
      backend: 'webhook',
      event: 'approval.requested',
      status: 'sent',
      channelId: channel.id,
      channelName: channel.name,
      urlOrigin: 'https://example.test',
      commitSha: 'abcdef1234567890',
    })
  })

  it('rejects delivery whose body was tampered with after signing', async () => {
    const fetchMock = stubOk()
    createWebhookChannel()
    const run = createPendingApprovalRun()

    await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    const timestamp = headers.get(WEBHOOK_HEADERS.timestamp)!
    const signature = headers.get(WEBHOOK_HEADERS.signature)!
    const realBody = String(init?.body)
    const tampered = realBody.replace(run.id, 'tampered-run-id')
    const recomputed = computeExpectedSignature(timestamp, tampered)
    expect(recomputed).not.toBe(signature.slice(WEBHOOK_HEADERS.signaturePrefix.length))
  })

  it('fails loudly when the webhook endpoint returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('nope', { status: 503 })))
    createWebhookChannel()
    const run = createPendingApprovalRun()

    await expect(new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id }))
      .rejects.toThrow('Webhook delivery failed: 503 nope')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Webhook delivery failed: 503'),
    })
  })

  it('skips disabled webhook channels visibly without calling fetch', async () => {
    const fetchMock = stubOk()
    createWebhookChannel({ config: { enabled: false, url: 'https://example.test/hook', secret: '${DUCTUM_TEST_WEBHOOK_SECRET}' } })
    const run = createPendingApprovalRun()

    const result = await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    expect(result).toMatchObject({ status: 'skipped' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(notificationEvidence(run.id)).toMatchObject({ status: 'skipped', reason: 'disabled' })
  })

  it('skips silently when no factory webhook channels are configured', async () => {
    const fetchMock = stubOk()
    const run = createPendingApprovalRun()

    const result = await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    expect(result).toMatchObject({ status: 'skipped', reason: 'no factory webhook channels configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not deliver to project-scoped webhook channels', async () => {
    const fetchMock = stubOk()
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: seeded.project.id,
      name: 'project-channel',
      spec: {
        backend: 'webhook',
        config: { url: 'https://example.test/hook', secret: '${DUCTUM_TEST_WEBHOOK_SECRET}' },
      },
    })
    const run = createPendingApprovalRun()

    const result = await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    expect(result).toMatchObject({ status: 'skipped' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not record the resolved secret or full URL path/query in evidence', async () => {
    stubOk()
    createWebhookChannel({
      config: {
        url: 'https://example.test/hook?token=supersecret&partner=acme',
        secret: '${DUCTUM_TEST_WEBHOOK_SECRET}',
      },
    })
    const run = createPendingApprovalRun()

    await new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id })

    const evidence = fixture.repos.evidence
      .list(run.id)
      .map((record) => record.payload)
      .find((payload) => payload.kind === 'notification.delivery')
    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain(SECRET_VALUE)
    expect(serialized).not.toContain('/hook')
    expect(serialized).not.toContain('token=')
    expect(serialized).not.toContain('partner=')
  })

  it('records malformed channel resolution as failure evidence', async () => {
    stubOk()
    createWebhookChannel({ config: { enabled: true } })
    const run = createPendingApprovalRun()

    await expect(new WebhookApprovalNotifier(fixture.context).send({ kind: 'approval.requested', runId: run.id }))
      .rejects.toThrow('webhook config missing: url')

    expect(notificationEvidence(run.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('webhook config missing: url'),
    })
  })

  it('delivers when the approval.requested event fires through the API event bus', async () => {
    const fetchMock = stubOk()
    createWebhookChannel()
    const run = createPendingApprovalRun()

    fixture.context.events.emit({ type: 'approval.requested', runId: run.id })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get(WEBHOOK_HEADERS.signature)).toMatch(/^sha256=[0-9a-f]+$/)
  })

  function createWebhookChannel(overrides: { config?: Record<string, unknown> } = {}): { id: string; name: string } {
    const name = overrides.config && 'name' in overrides.config ? String(overrides.config.name) : 'ops'
    const channel = fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: null,
      name,
      spec: {
        backend: 'webhook',
        config: overrides.config ?? {
          url: 'https://example.test/hook',
          secret: '${DUCTUM_TEST_WEBHOOK_SECRET}',
        },
      },
    })
    return { id: channel.id, name: channel.name }
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

  function notificationEvidence(runId: Run['id']): Record<string, unknown> {
    return fixture.repos.evidence
      .list(runId)
      .map((record) => record.payload)
      .find((payload) => payload.kind === 'notification.delivery') as Record<string, unknown>
  }
})

function stubOk() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function computeExpectedSignature(timestamp: string, body: string): string {
  return createHmac('sha256', SECRET_VALUE).update(`${timestamp}.${body}`).digest('hex')
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}
