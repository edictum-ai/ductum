import { log, redactPublicText, type RunId } from '@ductum/core'

import type {
  NotificationActionInput,
  NotificationActionResult,
  NotificationBackend,
  NotificationDeliveryResult,
  NotificationMessage,
} from './notification-backends.js'
import type { ApiContext } from './deps.js'
import { approveRun, rejectRun } from './run-ops.js'
import {
  isTelegramEnabled,
  recordTelegramDelivery,
  resolveTelegramRuntime,
  type TelegramRuntime,
} from './telegram-runtime.js'

export interface TelegramConfig {
  enabled: boolean
  botToken?: string
  chatId?: string
  webhookSecret?: string
  publicBaseUrl?: string
  channelRef?: string
  configError?: string
}

export type TelegramDecision = 'approve' | 'deny'

export function parseTelegramConfig(raw = process.env.DUCTUM_TELEGRAM_CONFIG): TelegramConfig {
  if (raw == null || raw.trim() === '') return { enabled: false }
  try {
    const parsed = JSON.parse(raw) as Partial<TelegramConfig>
    const botToken = cleanString(parsed.botToken)
    const chatId = cleanString(parsed.chatId)
    const webhookSecret = cleanString(parsed.webhookSecret)
    const channelRef = cleanString(parsed.channelRef)
    const publicBaseUrl = cleanString(parsed.publicBaseUrl)
    const channelOwnedFields = [
      parsed.enabled == null ? null : 'enabled',
      botToken == null ? null : 'botToken',
      chatId == null ? null : 'chatId',
      webhookSecret == null ? null : 'webhookSecret',
      publicBaseUrl == null ? null : 'publicBaseUrl',
    ].filter((field): field is string => field != null)
    if (channelRef != null && channelOwnedFields.length > 0) {
      const configError = `DUCTUM_TELEGRAM_CONFIG cannot combine channelRef with ${channelOwnedFields.join(', ')}`
      log.warn('telegram', configError)
      return {
        enabled: false,
        channelRef,
        configError,
      }
    }
    return {
      enabled: parsed.enabled === true && botToken != null && chatId != null && webhookSecret != null,
      ...(botToken == null ? {} : { botToken }),
      ...(chatId == null ? {} : { chatId }),
      ...(webhookSecret == null ? {} : { webhookSecret }),
      ...(publicBaseUrl == null ? {} : { publicBaseUrl }),
      ...(channelRef == null ? {} : { channelRef }),
    }
  } catch {
    log.warn('telegram', 'invalid DUCTUM_TELEGRAM_CONFIG; Telegram approvals disabled')
    return { enabled: false }
  }
}

export class TelegramApprovalNotifier implements NotificationBackend {
  readonly id = 'telegram'

  constructor(private readonly context: ApiContext) {}

  async send(message: NotificationMessage): Promise<NotificationDeliveryResult<'sent' | 'skipped'>> {
    return this.notifyApprovalRequested(message.runId)
  }

  supportsActions(): boolean {
    return true
  }

  async notifyApprovalRequested(runId: RunId): Promise<NotificationDeliveryResult<'sent' | 'skipped'>> {
    const run = this.context.repos.runs.get(runId)
    if (run == null || !run.pendingApproval) return { status: 'skipped', reason: 'run is not pending approval' }
    let runtime = failedTelegramRuntimeContext(this.context)
    try {
      runtime = resolveTelegramRuntime(this.context)
      if (!isTelegramEnabled(runtime.config)) {
        if (runtime.source === 'resource') {
          return recordTelegramDelivery(this.context, runId, runtime, 'skipped', runtime.skippedReason ?? 'disabled')
        }
        return { status: 'skipped', reason: 'telegram disabled' }
      }
      await this.call(runtime.config, 'sendMessage', {
        chat_id: runtime.config.chatId,
        text: formatApprovalMessage(this.context, runtime.config, runId),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: 'Approve', callback_data: `ductum:approve:${runId}` },
            { text: 'Deny', callback_data: `ductum:deny:${runId}` },
          ]],
        },
      })
      return runtime.source === 'resource'
        ? recordTelegramDelivery(this.context, runId, runtime, 'sent')
        : { status: 'sent' }
    } catch (error) {
      const message = redactPublicText(errorMessage(error))
      try {
        recordTelegramDelivery(this.context, runId, runtime, 'failed', undefined, message)
      } catch (recordError) {
        log.warn('telegram', `failed to record notification failure evidence: ${errorMessage(recordError)}`)
      }
      throw error
    }
  }

  async handleAction(input: NotificationActionInput): Promise<NotificationActionResult> {
    const runtime = resolveTelegramRuntime(this.context)
    if (!isTelegramEnabled(runtime.config)) {
      return { ok: false, runId: input.runId, action: input.action, error: 'telegram disabled', statusCode: 404 }
    }
    if (String(input.chatId ?? '') !== String(runtime.config.chatId ?? '')) {
      await this.answerCallback(runtime.config, input.callbackQueryId ?? '', 'This Telegram chat is not allowed.')
      return { ok: false, runId: input.runId, action: input.action, error: 'forbidden chat', statusCode: 403 }
    }
    try {
      if (input.action === 'approve') {
        await approveRun(this.context, input.runId)
        await this.answerCallback(runtime.config, input.callbackQueryId ?? '', 'Approved')
        await this.editDecisionMessage({
          config: runtime.config,
          chatId: input.chatId,
          messageId: input.messageId,
          runId: input.runId,
          status: 'approved',
          decidedBy: input.actor,
        })
      } else {
        await rejectRun(this.context, input.runId, `Denied from Telegram by ${input.actor}`)
        await this.answerCallback(runtime.config, input.callbackQueryId ?? '', 'Denied')
        await this.editDecisionMessage({
          config: runtime.config,
          chatId: input.chatId,
          messageId: input.messageId,
          runId: input.runId,
          status: 'denied',
          decidedBy: input.actor,
        })
      }
      return { ok: true, runId: input.runId, action: input.action }
    } catch (error) {
      const message = redactPublicText(errorMessage(error))
      await this.answerCallback(runtime.config, input.callbackQueryId ?? '', `Ductum could not ${input.action}: ${message.slice(0, 120)}`)
      return { ok: false, runId: input.runId, action: input.action, error: message }
    }
  }

  async answerCallback(config: TelegramConfig, callbackQueryId: string, text: string): Promise<void> {
    if (!isTelegramEnabled(config) || callbackQueryId === '') return
    await this.call(config, 'answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }).catch(() => undefined)
  }

  async editDecisionMessage(input: {
    chatId?: string | number
    messageId?: number
    runId: RunId
    status: 'approved' | 'denied'
    decidedBy: string
    config: TelegramConfig
  }): Promise<void> {
    if (!isTelegramEnabled(input.config) || input.chatId == null || input.messageId == null) return
    const label = input.status === 'approved' ? 'Approved' : 'Denied'
    await this.call(input.config, 'editMessageText', {
      chat_id: input.chatId,
      message_id: input.messageId,
      parse_mode: 'HTML',
      text: `<b>Ductum approval ${html(label)}</b>\n\n<code>${html(input.runId)}</code>\n${html(input.decidedBy)}`,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => undefined)
  }

  private async call(config: TelegramConfig, method: string, body: Record<string, unknown>): Promise<unknown> {
    if (config.botToken == null) throw new Error('Telegram bot token is not configured')
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(redactPublicText(`Telegram ${method} failed: ${response.status} ${await response.text()}`))
    }
    return await response.json().catch(() => ({}))
  }
}

export function parseTelegramDecision(data: unknown): { action: TelegramDecision; runId: RunId } | null {
  if (typeof data !== 'string') return null
  const parts = data.split(':')
  const action = parts.length === 3 && parts[0] === 'ductum' ? parts[1] : parts[0]
  const runId = parts.length === 3 && parts[0] === 'ductum' ? parts[2] : parts[1]
  if ((action !== 'approve' && action !== 'deny') || runId == null || runId === '') return null
  return { action, runId: runId as RunId }
}

function formatApprovalMessage(context: ApiContext, config: TelegramConfig, runId: RunId): string {
  const run = context.repos.runs.get(runId)
  const task = run == null ? null : context.repos.tasks.get(run.taskId)
  const spec = task == null ? null : context.repos.specs.get(task.specId)
  const project = spec == null ? null : context.repos.projects.get(spec.projectId)
  const agent = run == null ? null : context.repos.agents.get(run.agentId)
  const dashboardUrl = config.publicBaseUrl == null
    ? null
    : `${config.publicBaseUrl.replace(/\/$/, '')}/runs/${runId}`
  const lines = [
    '<b>Ductum approval requested</b>',
    '',
    `<b>Project:</b> ${html(project?.name ?? 'unknown')}`,
    `<b>Spec:</b> ${html(spec?.name ?? 'unknown')}`,
    `<b>Task:</b> ${html(task?.name ?? 'unknown')}`,
    `<b>Agent:</b> ${html(agent == null ? 'unknown' : `${agent.name} (${agent.model})`)}`,
    `<b>Run:</b> <code>${html(runId)}</code>`,
  ]
  if (run?.branch != null) lines.push(`<b>Branch:</b> <code>${html(run.branch)}</code>`)
  if (run?.commitSha != null) lines.push(`<b>Commit:</b> <code>${html(run.commitSha.slice(0, 12))}</code>`)
  if (dashboardUrl != null) lines.push('', `<a href="${html(dashboardUrl)}">Open run in Ductum</a>`)
  return lines.join('\n')
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function errorMessage(error: unknown): string {
  return redactPublicText(error instanceof Error ? error.message : String(error))
}

function failedTelegramRuntimeContext(context: ApiContext): TelegramRuntime {
  return {
    config: {
      enabled: false,
      ...(context.telegram.channelRef == null ? {} : { channelRef: context.telegram.channelRef }),
    },
    source: context.telegram.channelRef == null ? 'legacy' : 'resource',
    channel: null,
    skippedReason: null,
  }
}

function html(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
