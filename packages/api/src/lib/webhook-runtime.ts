import { createHmac } from 'node:crypto'

import {
  FactorySecretResolver,
  isFactorySecretRef,
  isSafeEnvReference,
  redactPublicText,
  type ConfigResource,
  type ConfigResourceSpec,
  type NotificationChannelSpec,
  type RunId,
} from '@ductum/core'

import type { NotificationDeliveryResult } from './notification-backends.js'
import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { addEvidence } from './run-ops.js'

export interface WebhookChannelConfig {
  url: string
  secret: string
  enabled: boolean
}

const ALLOWED_WEBHOOK_FIELDS = new Set(['url', 'secret', 'enabled'])

/**
 * Normalize and validate a webhook channel config block at config-write time.
 * Returns `null` when the block is empty so callers can omit the config field.
 */
export function normalizeWebhookChannelConfig(
  raw: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  rejectUnknownWebhookFields(raw, field)
  const enabled = raw.enabled == null ? true : requireBoolean(raw.enabled, `${field}.enabled`)
  const url = optionalStringValue(raw.url, `${field}.url`)
  const secret = optionalStringValue(raw.secret, `${field}.secret`)
  if (!enabled) {
    if (url == null && secret == null) return null
    return { enabled: false, ...(url == null ? {} : { url }), ...(secret == null ? {} : { secret }) }
  }
  if (url == null) throw new ValidationError(`${field}.url is required when webhook channel is enabled`)
  if (secret == null) throw new ValidationError(`${field}.secret is required when webhook channel is enabled`)
  assertWebhookUrl(url, `${field}.url`)
  return { enabled: true, url, secret }
}

export function assertWebhookUrl(value: string, field: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ValidationError(`${field} must be an absolute HTTPS URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError(`${field} must use the https: scheme`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError(`${field} must not embed credentials`)
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '') throw new ValidationError(`${field} must include a host`)
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::') {
    throw new ValidationError(`${field} must not target localhost`)
  }
  if (isLoopbackHost(host)) throw new ValidationError(`${field} must not target loopback addresses`)
  if (isPrivateIpv4Host(host)) throw new ValidationError(`${field} must not target RFC1918 private addresses`)
  if (isLinkLocalHost(host)) throw new ValidationError(`${field} must not target link-local addresses`)
}

function rejectUnknownWebhookFields(raw: Record<string, unknown>, field: string): void {
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_WEBHOOK_FIELDS.has(key)) {
      throw new ValidationError(`${field}.${key} is not supported for webhook NotificationChannel`)
    }
  }
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`)
  return value
}

function optionalStringValue(value: unknown, field: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isLoopbackHost(host: string): boolean {
  if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true
  if (/^127\./.test(host)) return true
  // IPv4-mapped IPv6 loopback
  if (/^::ffff:127\./.test(host)) return true
  return false
}

function isPrivateIpv4Host(host: string): boolean {
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  if (/^::ffff:10\./.test(host) || /^::ffff:192\.168\./.test(host)) return true
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

function isLinkLocalHost(host: string): boolean {
  if (/^169\.254\./.test(host)) return true
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true
  if (/^::ffff:169\.254\./.test(host)) return true
  return false
}

export function webhookConfigFromChannel(
  ref: string,
  raw: Record<string, unknown>,
  context: ApiContext,
): WebhookChannelConfig {
  rejectUnknownWebhookFields(raw, `NotificationChannel ${ref} config`)
  const enabled = raw.enabled == null ? true : requireBoolean(raw.enabled, `NotificationChannel ${ref} config.enabled`)
  const url = optionalStringValue(raw.url, `NotificationChannel ${ref} config.url`)
  const secret = optionalStringValue(raw.secret, `NotificationChannel ${ref} config.secret`)
  if (!enabled) {
    return { enabled: false, url: url ?? '', secret: '' }
  }
  if (url == null) throw new ValidationError(`NotificationChannel ${ref} webhook config missing: url`)
  if (secret == null) throw new ValidationError(`NotificationChannel ${ref} webhook config missing: secret`)
  assertWebhookUrl(url, `NotificationChannel ${ref} config.url`)
  return {
    enabled: true,
    url,
    secret: resolveRuntimeValue(ref, 'secret', secret, context),
  }
}

function resolveRuntimeValue(ref: string, field: string, value: string, context: ApiContext): string {
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
  if (context.factoryDataDir == null || context.factoryDataDir.trim() === '') {
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

export function computeWebhookSignature(timestamp: string, body: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function redactWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return '[redacted]'
  }
}

export function recordWebhookDelivery<TStatus extends 'sent' | 'skipped' | 'failed'>(
  context: ApiContext,
  runId: RunId,
  channel: ConfigResource,
  status: TStatus,
  details?: { url?: string; reason?: string; error?: string },
): NotificationDeliveryResult<TStatus> {
  const evidence = addEvidence(context, runId, 'custom', {
    kind: 'notification.delivery',
    backend: 'webhook',
    event: 'approval.requested',
    status,
    channelId: channel.id,
    channelName: channel.name,
    ...(details?.url == null ? {} : { urlOrigin: redactWebhookUrl(details.url) }),
    ...(details?.reason == null ? {} : { reason: redactPublicText(details.reason) }),
    ...(details?.error == null ? {} : { error: redactPublicText(details.error) }),
  })
  return {
    status,
    evidenceId: evidence.id,
    ...(details?.reason == null ? {} : { reason: redactPublicText(details.reason) }),
    ...(details?.error == null ? {} : { error: redactPublicText(details.error) }),
  }
}

export function listFactoryWebhookChannels(context: ApiContext): ConfigResource[] {
  return context.repos.configResources
    .list({ kind: 'NotificationChannel', projectId: null })
    .filter((resource) => isWebhookChannelSpec(resource.spec))
}

export function isWebhookChannelSpec(spec: ConfigResourceSpec): spec is NotificationChannelSpec {
  return (spec as NotificationChannelSpec).backend === 'webhook'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
