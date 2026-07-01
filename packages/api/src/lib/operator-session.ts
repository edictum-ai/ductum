import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const COOKIE_NAME = 'ductum_operator_token'
const OPERATOR_SESSION_ID_PREFIX = 'dos_'
const DEFAULT_OPERATOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type LocalSessionReconnectResult =
  | { ok: true; sessionId: string; expiresAtMs: number }
  | { ok: false; status: ContentfulStatusCode; reason: string }

export type LocalOperatorTokenDetectResult =
  | { ok: true; operatorToken: string }
  | { ok: false; status: ContentfulStatusCode; reason: string }

export type LocalInternalRequestResult =
  | { ok: true }
  | { ok: false; status: ContentfulStatusCode; reason: string }

interface OperatorSessionRecord {
  tokenHash: string
  expiresAtMs: number
}

export class OperatorSessionStore {
  private readonly sessions = new Map<string, OperatorSessionRecord>()

  constructor(private readonly ttlMs = DEFAULT_OPERATOR_SESSION_TTL_MS) {}

  mint(input: { operatorToken: string; nowMs: number }): { sessionId: string; expiresAtMs: number } {
    this.prune(input.nowMs)
    const sessionId = `${OPERATOR_SESSION_ID_PREFIX}${randomBytes(32).toString('base64url')}`
    const expiresAtMs = input.nowMs + this.ttlMs
    this.sessions.set(sessionId, {
      tokenHash: hashToken(input.operatorToken),
      expiresAtMs,
    })
    return { sessionId, expiresAtMs }
  }

  validate(input: { sessionId: string; operatorToken: string; nowMs: number }): boolean {
    const record = this.sessions.get(input.sessionId)
    if (record == null) return false
    if (record.expiresAtMs <= input.nowMs) {
      this.sessions.delete(input.sessionId)
      return false
    }
    return hashesMatch(record.tokenHash, hashToken(input.operatorToken))
  }

  revoke(sessionId: string | null | undefined): void {
    if (sessionId == null || sessionId === '') return
    this.sessions.delete(sessionId)
  }

  prune(nowMs: number): void {
    for (const [sessionId, record] of this.sessions) {
      if (record.expiresAtMs <= nowMs) this.sessions.delete(sessionId)
    }
  }
}

export function localInternalRequestResult(c: Context): LocalInternalRequestResult {
  const requestUrl = safeUrl(c.req.url)
  const requestHost = normalizedHost(c.req.header('host') ?? requestUrl?.host)
  if (!isLoopbackHost(requestHost)) {
    return { ok: false, status: 403, reason: 'Request host is not loopback; local internal endpoint disabled' }
  }

  const requestOrigin = `${requestUrl?.protocol ?? 'http:'}//${normalizedAuthority(c.req.header('host') ?? requestUrl?.host)}`
  const origin = c.req.header('origin')
  if (origin != null && origin !== '' && normalizedOrigin(origin) !== requestOrigin) {
    return { ok: false, status: 403, reason: 'Origin is not same-origin; local internal endpoint disabled' }
  }

  const referer = c.req.header('referer')
  if (referer != null && referer !== '' && normalizedOrigin(referer) !== requestOrigin) {
    return { ok: false, status: 403, reason: 'Referer is not same-origin; local internal endpoint disabled' }
  }

  return { ok: true }
}

export function localSessionReconnectResult(
  operatorToken: string | undefined,
  env: Record<string, string | undefined>,
  sessions: OperatorSessionStore,
  nowMs: number,
): LocalSessionReconnectResult {
  if (env.DUCTUM_DISABLE_LOCAL_SESSION_RECONNECT === '1') {
    return { ok: false, status: 403, reason: 'Local browser reconnect disabled' }
  }
  const result = localLoopbackOperatorTokenResult(operatorToken, env)
  if (!result.ok) return result
  return { ok: true, ...sessions.mint({ operatorToken: result.operatorToken, nowMs }) }
}

export function localOperatorTokenDetectResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalOperatorTokenDetectResult {
  if (env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT !== '1') {
    return { ok: false, status: 403, reason: 'Operator token detection requires explicit server opt-in' }
  }
  return localLoopbackOperatorTokenResult(operatorToken, env)
}

function localLoopbackOperatorTokenResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalOperatorTokenDetectResult {
  const host = (env.DUCTUM_HOST ?? '127.0.0.1').trim()
  if (!isLoopbackHost(normalizedHost(host))) {
    return { ok: false, status: 403, reason: 'API host is not loopback; local reconnect disabled' }
  }
  if (env.DUCTUM_PUBLIC_BASE_URL?.trim()) {
    return { ok: false, status: 403, reason: 'Public API URL configured; local reconnect disabled' }
  }
  const token = operatorToken?.trim()
  if (token == null || token === '') {
    return { ok: false, status: 404, reason: 'No operator token configured' }
  }
  return { ok: true, operatorToken: token }
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizedOrigin(value: string): string | null {
  const parsed = safeUrl(value)
  if (parsed == null) return null
  return `${parsed.protocol}//${normalizedAuthority(parsed.host)}`
}

function normalizedHost(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return ''
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end === -1) return trimmed.toLowerCase()
    return trimmed.slice(1, end).toLowerCase()
  }
  return trimmed.split(':')[0]?.toLowerCase() ?? null
}

function normalizedAuthority(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') return ''
  try {
    const parsed = new URL(`http://${trimmed}`)
    return parsed.host.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function isLoopbackHost(host: string | null): boolean {
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function shouldUseSecureCookie(c: Context): boolean {
  const forwardedProto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (forwardedProto === 'https') return true
  if (forwardedProto === 'http') return false
  try {
    return new URL(c.req.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function serializeOperatorCookie(value: string, secure: boolean, maxAgeSeconds = Math.floor(DEFAULT_OPERATOR_SESSION_TTL_MS / 1000)): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; ')
}

export function clearOperatorCookie(secure: boolean): string {
  return [
    `${COOKIE_NAME}=`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ')
}

export function readOperatorCookie(header: string): string | null {
  return readCookie(header, COOKIE_NAME)
}

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    if (key !== name) continue
    const raw = part.slice(index + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function hashesMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
