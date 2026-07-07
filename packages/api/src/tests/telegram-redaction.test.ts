import { describe, expect, it, vi } from 'vitest'
import { createId } from '@ductum/core'

import { TelegramApprovalNotifier } from '../lib/telegram.js'
import { createFixture, seedBase } from './helpers.js'

describe('Telegram approval callback redaction', () => {
  it('redacts approval failure reasons returned before the callback answer is built', async () => {
    const fixture = await createFixture({ operatorToken: 'missing', telegram: { enabled: false, channelRef: 'ops' } })
    try {
      const seeded = seedBase(fixture)
      fixture.repos.configResources.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'NotificationChannel',
        projectId: null,
        name: 'ops',
        spec: {
          backend: 'telegram',
          config: {
            botToken: '123:test',
            chatId: '456',
            webhookSecret: 'secret',
          },
        },
      })
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
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
        branch: 'feature/redaction',
        commitSha: 'abc123',
        prNumber: null,
        prUrl: null,
        worktreePaths: ['/tmp/sk-proj-test-secret'],
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

      const result = await new TelegramApprovalNotifier(fixture.context).handleAction({
        action: 'approve',
        runId: run.id,
        actor: 'telegram:ops',
        callbackQueryId: 'cb-1',
        chatId: 456,
        messageId: 1,
      })

      const callback = fetchMock.mock.calls.find((call) => String(call[0]).includes('/answerCallbackQuery'))
      const body = JSON.parse(String(callback?.[1]?.body)) as { text: string }
      expect(result).toMatchObject({ ok: false, runId: run.id, action: 'approve', error: expect.stringContaining('[redacted]') })
      expect(String(result.error)).not.toContain('sk-proj-test-secret')
      expect(body.text).toContain('[redacted]')
      expect(body.text).not.toContain('sk-proj-test-secret')
    } finally {
      vi.unstubAllGlobals()
      fixture.close()
    }
  })
})
