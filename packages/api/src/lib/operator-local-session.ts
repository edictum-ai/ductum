import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Context } from 'hono'

import type { OperatorSessionStore } from './operator-session.js'

export type LocalSessionReconnectResult =
  | { ok: true; sessionId: string; expiresAtMs: number }
  | { ok: false; status: ContentfulStatusCode; reason: string }

type LocalOperatorTokenResult =
  | { ok: true; operatorToken: string }
  | { ok: false; status: ContentfulStatusCode; reason: string }

export type LocalInternalRequestResult =
  | { ok: true }
  | { ok: false; status: ContentfulStatusCode; reason: string }

export function localInternalRequestResult(c: Context): LocalInternalRequestResult {
  const requestUrl = safeUrl(c.req.url)
  const requestHost = normalizedHost(c.req.header('host') ?? requestUrl?.host)
  if (!isLoopbackHost(requestHost)) {
    return { ok: false, status: 403, reason: 'Request host is not loopback; local internal endpoint disabled' }
  }

  const requestOrigin = `${requestUrl?.protocol ?? 'http:'}//${normalizedAuthority(c.req.header('host') ?? requestUrl?.host)}`
  const allowedOrigins = allowedLocalInternalOrigins(requestOrigin)
  const origin = c.req.header('origin')
  const referer = c.req.header('referer')
  const originOk = origin != null && origin !== '' && allowedOrigins.has(normalizedOrigin(origin) ?? '')
  const refererOk = referer != null && referer !== '' && allowedOrigins.has(normalizedOrigin(referer) ?? '')
  if (!originOk && !refererOk) {
    return { ok: false, status: 403, reason: 'Trusted local browser signal required for local internal endpoint' }
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
  const minted = sessions.mint({ operatorToken: result.operatorToken, nowMs })
  return { ok: true, sessionId: minted.sessionId, expiresAtMs: minted.expiresAtMs }
}

function localLoopbackOperatorTokenResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalOperatorTokenResult {
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

function allowedLocalInternalOrigins(requestOrigin: string): Set<string> {
  const port = process.env.DUCTUM_DASHBOARD_PORT?.trim() || '5176'
  const values = [
    requestOrigin,
    process.env.DUCTUM_DASHBOARD_URL,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]
  return new Set(values.map((value) => value == null ? null : normalizedOrigin(value)).filter((value): value is string => value != null))
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
  // Fail closed on null/empty hosts. A real browser request on HTTP/1.1+
  // always carries an explicit Host header; an empty/missing host is a
  // forged or malformed request and must not be treated as loopback even
  // when paired with a same-origin Referer/Origin header (defense-in-depth
  // against Host-header stripping attacks).
  if (host == null || host === '') return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}
