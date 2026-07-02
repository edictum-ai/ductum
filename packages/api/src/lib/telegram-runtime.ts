import {
  FactorySecretResolver,
  isFactorySecretRef,
  isSafeEnvReference,
  redactPublicText,
  type ConfigResource,
  type RunId,
} from '@ductum/core'

import type { NotificationDeliveryResult } from './notification-backends.js'
import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { assertTelegramChannel, resolveNotificationChannelResource } from './notification-channels.js'
import { addEvidence } from './run-ops.js'
import type { TelegramConfig } from './telegram.js'

export interface TelegramRuntime {
  config: TelegramConfig
  source: 'legacy' | 'resource'
  channel: ConfigResource | null
  skippedReason: string | null
}

export interface TelegramStatus {
  enabled: boolean
  configured: boolean
  missing: string[]
  webhookUrl: string | null
  channelRef?: string
  channel?: { id: string; name: string; backend: string }
  skipped?: string
  error?: string
}

export function getTelegramStatus(context: ApiContext): TelegramStatus {
  try {
    const runtime = resolveTelegramRuntime(context)
    const disabled = runtime.source === 'resource' && runtime.skippedReason === 'disabled'
    const missing = disabled ? [] : missingTelegramFields(runtime.config)
    return {
      enabled: isTelegramEnabled(runtime.config),
      configured: !disabled && missing.length === 0,
      missing,
      webhookUrl: telegramWebhookUrl(runtime.config),
      ...(runtime.config.channelRef == null ? {} : { channelRef: runtime.config.channelRef }),
      ...(runtime.channel == null ? {} : { channel: { id: runtime.channel.id, name: runtime.channel.name, backend: 'telegram' } }),
      ...(runtime.skippedReason == null ? {} : { skipped: runtime.skippedReason }),
    }
  } catch (error) {
    return {
      enabled: false,
      configured: false,
      missing: [],
      webhookUrl: null,
      ...(context.telegram.channelRef == null ? {} : { channelRef: context.telegram.channelRef }),
      error: errorMessage(error),
    }
  }
}

export function resolveTelegramRuntime(context: ApiContext): TelegramRuntime {
  if (context.telegram.configError != null) {
    throw new ValidationError(context.telegram.configError)
  }
  const ref = context.telegram.channelRef
  if (ref == null) return { config: context.telegram, source: 'legacy', channel: null, skippedReason: null }
  const channel = resolveNotificationChannelResource(ref, context.repos.configResources)
  const spec = assertTelegramChannel(channel)
  const config = telegramConfigFromChannel(ref, spec.config ?? {}, context)
  return {
    config,
    source: 'resource',
    channel,
    skippedReason: config.enabled ? null : 'disabled',
  }
}

export function isTelegramEnabled(config: TelegramConfig): boolean {
  return config.enabled && config.botToken != null && config.chatId != null && config.webhookSecret != null
}

export function telegramWebhookUrl(config: TelegramConfig): string | null {
  if (!isTelegramEnabled(config) || config.publicBaseUrl == null) return null
  return `${config.publicBaseUrl.replace(/\/$/, '')}/api/telegram/webhook`
}

export function recordTelegramDelivery<TStatus extends 'sent' | 'skipped' | 'failed'>(
  context: ApiContext,
  runId: RunId,
  runtime: TelegramRuntime,
  status: TStatus,
  reason?: string,
  error?: string,
): NotificationDeliveryResult<TStatus> {
  const evidence = addEvidence(context, runId, 'custom', {
    kind: 'notification.delivery',
    backend: 'telegram',
    event: 'approval.requested',
    status,
    source: runtime.source,
    ...(runtime.config.channelRef == null ? {} : { channelRef: runtime.config.channelRef }),
    ...(runtime.channel == null ? {} : { channelId: runtime.channel.id, channelName: runtime.channel.name }),
    ...(reason == null ? {} : { reason: redactPublicText(reason) }),
    ...(error == null ? {} : { error: redactPublicText(error) }),
  })
  return {
    status,
    evidenceId: evidence.id,
    ...(reason == null ? {} : { reason: redactPublicText(reason) }),
    ...(error == null ? {} : { error: redactPublicText(error) }),
  }
}

export function telegramConfigFromChannel(
  ref: string,
  raw: Record<string, unknown>,
  context?: ApiContext,
): TelegramConfig {
  const enabled = raw.enabled === false ? false : true
  if (raw.enabled != null && typeof raw.enabled !== 'boolean') {
    throw new ValidationError(`NotificationChannel ${ref} config.enabled must be a boolean`)
  }
  const botToken = cleanString(raw.botToken)
  const chatId = cleanString(raw.chatId)
  const webhookSecret = cleanString(raw.webhookSecret)
  const publicBaseUrl = cleanString(raw.publicBaseUrl)
  if (!enabled) {
    return { enabled: false, channelRef: ref, ...(publicBaseUrl == null ? {} : { publicBaseUrl }) }
  }
  if (botToken == null || chatId == null || webhookSecret == null) {
    const missing = [
      botToken == null ? 'botToken' : null,
      chatId == null ? 'chatId' : null,
      webhookSecret == null ? 'webhookSecret' : null,
    ].filter((item): item is string => item != null)
    throw new ValidationError(`NotificationChannel ${ref} telegram config missing: ${missing.join(', ')}`)
  }
  return {
    enabled: true,
    channelRef: ref,
    botToken: resolveRuntimeValue(ref, 'botToken', botToken, context),
    chatId: resolveRuntimeValue(ref, 'chatId', chatId, context),
    webhookSecret: resolveRuntimeValue(ref, 'webhookSecret', webhookSecret, context),
    ...(publicBaseUrl == null ? {} : { publicBaseUrl }),
  }
}

function missingTelegramFields(config: TelegramConfig): string[] {
  return [
    config.botToken == null ? 'botToken' : null,
    config.chatId == null ? 'chatId' : null,
    config.webhookSecret == null ? 'webhookSecret' : null,
  ].filter((item): item is string => item != null)
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function resolveRuntimeValue(ref: string, field: string, value: string, context: ApiContext | undefined): string {
  const trimmed = value.trim()
  if (isSafeEnvReference(trimmed)) {
    const envName = trimmed.slice(2, -1)
    const resolved = process.env[envName]?.trim()
    if (resolved == null || resolved === '') {
      throw new ValidationError(`NotificationChannel ${ref} config.${field} references missing environment variable: ${envName}`)
    }
    return resolved
  }
  if (!isFactorySecretRef(trimmed)) return trimmed
  if (context == null || context.factoryDataDir == null || context.factoryDataDir.trim() === '') {
    throw new ValidationError(`NotificationChannel ${ref} config.${field} references a Ductum secret but local secret storage is unavailable`)
  }
  try {
    return new FactorySecretResolver({
      factoryDir: context.factoryDataDir,
      secrets: context.repos.secrets,
      accessLog: context.repos.secretAccessLog,
    }).resolve(trimmed)
  } catch (error) {
    throw new ValidationError(`NotificationChannel ${ref} config.${field} ${errorMessage(error)}`)
  }
}

function errorMessage(error: unknown): string {
  return redactPublicText(error instanceof Error ? error.message : String(error))
}
