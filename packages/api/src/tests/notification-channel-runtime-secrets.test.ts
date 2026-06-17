import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createId, type Run } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TelegramApprovalNotifier } from '../lib/telegram.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let dirs: string[] = []
let oldChatId: string | undefined

afterEach(async () => {
  fixture?.close()
  fixture = undefined
  vi.unstubAllGlobals()
  if (oldChatId == null) delete process.env.DUCTUM_TEST_TELEGRAM_CHAT_ID
  else process.env.DUCTUM_TEST_TELEGRAM_CHAT_ID = oldChatId
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('NotificationChannel runtime secret references', () => {
  it('resolves Ductum secret and env refs before calling Telegram', async () => {
    oldChatId = process.env.DUCTUM_TEST_TELEGRAM_CHAT_ID
    process.env.DUCTUM_TEST_TELEGRAM_CHAT_ID = '456'
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({
      factoryDataDir: factoryDir,
      telegram: { enabled: false, channelRef: 'ops' },
    })
    const seeded = seedBase(fixture)
    const bot = await createSecret('telegram-bot', '123456:runtime-bot-secret')
    const webhook = await createSecret('telegram-webhook', 'runtime-webhook-secret')
    const channel = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: {
          backend: 'telegram',
          config: {
            botToken: `secret:${bot.id}`,
            chatId: '${DUCTUM_TEST_TELEGRAM_CHAT_ID}',
            webhookSecret: `secret:${webhook.id}`,
            publicBaseUrl: 'https://factory.example.test',
          },
        },
      },
    })
    expect(channel.response.status).toBe(201)
    const fetchMock = stubTelegramOk()
    const run = createPendingApprovalRun(seeded.task.id, seeded.builder.id)

    const result = await new TelegramApprovalNotifier(fixture.context).notifyApprovalRequested(run.id)

    expect(result.status).toBe('sent')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/bot123456:runtime-bot-secret/sendMessage')
    expect(requestBody(fetchMock).chat_id).toBe('456')
  })
})

async function createSecret(name: string, value: string): Promise<{ id: string }> {
  const result = await requestJson(fixture!.app, '/api/factory/secrets', {
    method: 'POST',
    body: { name, value },
  })
  expect(result.response.status).toBe(201)
  return result.json as { id: string }
}

function createPendingApprovalRun(taskId: Run['taskId'], agentId: Run['agentId']): Run {
  return fixture!.repos.runs.create({
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feature/channel-refs',
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
}

function stubTelegramOk() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function requestBody(fetchMock: ReturnType<typeof stubTelegramOk>) {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { chat_id: string }
}

async function factoryDirWithKey(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-api-telegram-secrets-'))
  dirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  const keyPath = join(dir, '.ductum', 'secrets.key')
  await writeFile(keyPath, randomBytes(32), { mode: 0o600 })
  await chmod(keyPath, 0o600)
  return dir
}
