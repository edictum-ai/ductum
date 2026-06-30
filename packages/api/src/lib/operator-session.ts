import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const COOKIE_NAME = 'ductum_operator_token'

export type LocalSessionReconnectResult =
  | { ok: true; operatorToken: string }
  | { ok: false; status: ContentfulStatusCode; reason: string }

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
  const loopback = ['', 'localhost', '127.0.0.1', '::1'].includes(host)
  if (!loopback) {
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
