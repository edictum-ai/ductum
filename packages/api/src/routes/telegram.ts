import type { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { log, redactPublicText } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { ValidationError } from '../lib/errors.js'
import type { NotificationBackend } from '../lib/notification-backends.js'
import { optionalString, readJson } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'
import { getTelegramStatus, isTelegramEnabled, resolveTelegramRuntime } from '../lib/telegram-runtime.js'
import {
  parseTelegramDecision,
  TelegramApprovalNotifier,
} from '../lib/telegram.js'

export function registerTelegramRoutes(app: Hono, context: ApiContext) {
  const telegramBackend = new TelegramApprovalNotifier(context)
  const notifier: NotificationBackend = telegramBackend

  context.events.subscribe((event) => {
    if (event.type === 'approval.requested') {
      void notifier.send({ kind: 'approval.requested', runId: event.runId }).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('telegram', `approval notification failed: ${msg}`)
      })
    }
  })

  app.get('/api/telegram/status', (c) => c.json(publicOutput(getTelegramStatus(context))))

  // P4.4: Dashboard "Discover chat id" button. Calls Telegram getUpdates
  // server-side using the configured channel's bot token so the operator
  // never has to leak the token into the browser.
  app.get('/api/telegram/chats', async (c) => {
    try {
      const runtime = resolveTelegramRuntime(context)
      const token = runtime.config.botToken
      if (token == null || token.trim() === '') {
        return c.json({ ok: false, error: 'Bot token not configured' }, 400)
      }
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        result?: unknown[]
        description?: string
      }
      if (!data.ok) {
        return c.json({ ok: false, error: redactPublicText(data.description ?? 'Telegram getUpdates failed') }, 502)
      }
      return c.json(publicOutput({ ok: true, chats: chatsFromUpdates(data.result ?? []) }))
    } catch (error) {
      const message = redactPublicText(error instanceof Error ? error.message : String(error))
      return c.json({ ok: false, error: message }, 503)
    }
  })

  // P4.4: Dashboard "Test send" button. Posts a real message via the
  // configured bot — first end-to-end verification that the wired
  // NotificationChannel actually reaches Telegram. The wizard's exit
  // demo depends on this round-trip working.
  app.post('/api/telegram/test-send', async (c) => {
    try {
      const body = (await readJson<Record<string, unknown>>(c).catch(() => ({}))) as Record<string, unknown>
      const customText = optionalString(body.text, 'text')
      const runtime = resolveTelegramRuntime(context)
      const token = runtime.config.botToken
      const chatId = runtime.config.chatId
      if (token == null || chatId == null) {
        throw new ValidationError('Telegram channel must have botToken and chatId configured before Test send')
      }
      const text = customText ?? `<b>Ductum test</b>\nNotificationChannel ${runtime.config.channelRef ?? 'legacy'} is reachable.`
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText)
        return c.json({ ok: false, error: redactPublicText(`Telegram sendMessage failed: ${response.status} ${detail}`) }, 502)
      }
      return c.json(publicOutput({ ok: true, chatId, channelRef: runtime.config.channelRef ?? null }))
    } catch (error) {
      const message = redactPublicText(error instanceof Error ? error.message : String(error))
      const status = error instanceof ValidationError ? 400 : 503
      return c.json({ ok: false, error: message }, status)
    }
  })

  app.post('/api/telegram/webhook', async (c) => {
    const runtime = (() => {
      try {
        return resolveTelegramRuntime(context)
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error))
      }
    })()
    if (runtime instanceof Error) {
      log.warn('telegram', `webhook unavailable: ${redactPublicText(runtime.message)}`)
      return c.json({ ok: false, error: 'telegram misconfigured' }, 503)
    }
    if (!isTelegramEnabled(runtime.config)) {
      return c.json({ ok: false, error: 'telegram disabled' }, 404)
    }
    const expectedSecret = runtime.config.webhookSecret!
    const actual = c.req.header('x-telegram-bot-api-secret-token') ?? ''
    if (!secretMatches(actual, expectedSecret)) return c.json({ ok: false, error: 'forbidden' }, 403)

    const body = (await readJson<Record<string, unknown>>(c).catch(() => ({}))) as Record<string, unknown>
    const callback = asRecord(body.callback_query)
    if (callback == null) return c.json(publicOutput({ ok: true, ignored: true }))

    const callbackId = optionalString(callback.id, 'id') ?? ''
    const parsed = parseTelegramDecision(callback.data)
    if (parsed == null) {
      await telegramBackend.answerCallback(runtime.config, callbackId, 'Unknown Ductum action.')
      return c.json(publicOutput({ ok: true, ignored: true }))
    }

    const actor = formatActor(asRecord(callback.from))
    const message = asRecord(callback.message)
    const chat = asRecord(message?.chat)
    const chatId = typeof chat?.id === 'string' || typeof chat?.id === 'number' ? chat.id : undefined
    const messageId = typeof message?.message_id === 'number' ? message.message_id : undefined
    const result = await telegramBackend.handleAction({
      action: parsed.action,
      runId: parsed.runId,
      actor,
      callbackQueryId: callbackId,
      chatId,
      messageId,
    })
    const { statusCode, ...payload } = result
    const status = statusCode === 403 || statusCode === 404 ? statusCode : 200
    return c.json(publicOutput(payload), status)
  })
}

function secretMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

interface TelegramChatSummary {
  id: number
  type?: string
  title?: string
  username?: string
}

function chatsFromUpdates(updates: unknown[]): TelegramChatSummary[] {
  const seen = new Map<number, TelegramChatSummary>()
  for (const update of updates) {
    if (update == null || typeof update !== 'object') continue
    const wrappers = chatBearersFromUpdate(update as Record<string, unknown>)
    for (const wrapper of wrappers) {
      const chat = asRecord(wrapper?.chat)
      if (chat == null) continue
      const id = chat.id
      if (typeof id !== 'number') continue
      if (seen.has(id)) continue
      seen.set(id, {
        id,
        ...(typeof chat.type === 'string' ? { type: chat.type } : {}),
        ...(typeof chat.title === 'string' ? { title: chat.title } : {}),
        ...(typeof chat.username === 'string' ? { username: chat.username } : {}),
      })
    }
  }
  return [...seen.values()]
}

function chatBearersFromUpdate(update: Record<string, unknown>): Array<{ chat?: unknown }> {
  const bearers: Array<{ chat?: unknown }> = []
  const KEYS = [
    'message', 'edited_message', 'channel_post', 'edited_channel_post',
    'my_chat_member', 'chat_member', 'chat_join_request',
  ]
  for (const key of KEYS) {
    const value = asRecord(update[key])
    if (value != null) bearers.push(value as { chat?: unknown })
  }
  const callback = asRecord(update.callback_query)
  const callbackMessage = asRecord(callback?.message)
  if (callbackMessage != null) bearers.push(callbackMessage as { chat?: unknown })
  return bearers
}

function formatActor(from: Record<string, unknown> | null): string {
  const username = optionalString(from?.username, 'username')
  if (username != null) return `telegram:${username}`
  const id = from?.id
  if (typeof id === 'string' || typeof id === 'number') return `telegram:${id}`
  return 'telegram:unknown'
}
