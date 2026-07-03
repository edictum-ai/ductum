import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

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
 * The block cannot be empty: an enabled webhook channel defaults to
 * `enabled:true` and therefore requires `url` and `secret`. Only an explicit
 * `enabled:false` lets the caller omit them. An explicit `enabled:false` is
 * always preserved so the channel round-trips as disabled at runtime instead
 * of being treated as enabled-by-default when the url/secret are absent.
 */
export function normalizeWebhookChannelConfig(
  raw: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  rejectUnknownWebhookFields(raw, field)
  const enabled = raw.enabled == null ? true : requireBoolean(raw.enabled, `${field}.enabled`)
  const url = optionalStringValue(raw.url, `${field}.url`)
  const secret = optionalStringValue(raw.secret, `${field}.secret`)
  if (!enabled) {
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
  assertSafeWebhookHost(host, field)
}

function assertSafeWebhookHost(host: string, field: string): void {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::') {
    throw new ValidationError(`${field} must not target localhost`)
  }
  // Defense-in-depth: Node's WHATWG URL parser canonicalizes single-label
  // decimal/hex/octal integer IPv4 forms (e.g. "2130706433", "0x7f000001",
  // "017700000001") to dotted-decimal before we see them, but reject the raw
  // encodings explicitly in case parser behavior changes.
  if (looksLikeEncodedIpv4Host(host)) {
    throw new ValidationError(`${field} must not target encoded IP literals`)
  }
  const family = isIP(host)
  if (family === 4) {
    assertSafeIpv4Literal(host, field)
    return
  }
  if (family === 6) {
    assertSafeIpv6Literal(host, field)
    return
  }
}

function assertSafeIpv4Literal(ip: string, field: string): void {
  if (isLoopbackIpv4(ip)) throw new ValidationError(`${field} must not target loopback addresses`)
  if (isPrivateIpv4(ip)) throw new ValidationError(`${field} must not target RFC1918 private addresses`)
  if (isLinkLocalIpv4(ip)) throw new ValidationError(`${field} must not target link-local addresses`)
}

function assertSafeIpv6Literal(ip: string, field: string): void {
  if (ip === '::1') throw new ValidationError(`${field} must not target loopback addresses`)
  if (isUniqueLocalIpv6(ip)) {
    throw new ValidationError(`${field} must not target unique-local IPv6 addresses`)
  }
  if (isLinkLocalIpv6(ip)) {
    throw new ValidationError(`${field} must not target link-local addresses`)
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:xxxx:xxxx). Node canonicalizes
  // these to the hex form, so re-decode and apply IPv4 rules to the inner
  // address — otherwise ::ffff:7f00:1 sails past the IPv4 regexes.
  const mapped = ipv4MappedFromIpv6(ip)
  if (mapped != null) {
    assertSafeIpv4Literal(mapped, field)
  }
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

function isLoopbackIpv4(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '0.0.0.0') return true
  return /^127\./.test(ip)
}

function isPrivateIpv4(ip: string): boolean {
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  return /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

function isLinkLocalIpv4(ip: string): boolean {
  return /^169\.254\./.test(ip)
}

function isUniqueLocalIpv6(ip: string): boolean {
  // RFC 4193 unique-local fc00::/7 covers both fc00::/8 and fd00::/8.
  return /^f[cd][0-9a-f]{0,2}(?::|$)/i.test(ip)
}

function isLinkLocalIpv6(ip: string): boolean {
  // fe80::/10 — first 10 bits are 1111111010 (fe8, fe9, fea, feb).
  return /^fe[89ab][0-9a-f]{0,1}(?::|$)/i.test(ip)
}

function ipv4MappedFromIpv6(ip: string): string | null {
  // After WHATWG URL canonicalization, IPv4-mapped IPv6 looks like
  // "::ffff:xxxx:xxxx" with variable-length hex groups. Inputs may also
  // arrive in the dotted-decimal form "::ffff:a.b.c.d".
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip)
  if (hex != null) {
    const hi = parseInt(hex[1]!, 16)
    const lo = parseInt(hex[2]!, 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }
  const dotted = /^::ffff:([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/i.exec(ip)
  if (dotted != null) {
    return dotted[1]!
  }
  return null
}

function looksLikeEncodedIpv4Host(host: string): boolean {
  if (host.includes('.')) return false
  if (/^[0-9]+$/.test(host)) return true
  if (/^0x[0-9a-f]+$/i.test(host)) return true
  return /^0[0-7]+$/.test(host)
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
