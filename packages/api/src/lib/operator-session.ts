import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const COOKIE_NAME = 'ductum_operator_token'

export type LocalSessionReconnectResult =
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

export function localSessionReconnectResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalSessionReconnectResult {
  if (env.DUCTUM_DISABLE_LOCAL_SESSION_RECONNECT === '1') {
    return { ok: false, status: 403, reason: 'Local browser reconnect disabled' }
  }
  return localLoopbackOperatorTokenResult(operatorToken, env)
}

export function localOperatorTokenDetectResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalSessionReconnectResult {
  if (env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT !== '1') {
    return { ok: false, status: 403, reason: 'Operator token detection requires explicit server opt-in' }
  }
  return localLoopbackOperatorTokenResult(operatorToken, env)
}

function localLoopbackOperatorTokenResult(operatorToken: string | undefined, env: Record<string, string | undefined>): LocalSessionReconnectResult {
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

export function serializeOperatorCookie(value: string, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
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
