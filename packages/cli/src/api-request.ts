import { redactPublicOutput, redactPublicText } from '@ductum/core'

import type { ApiErrorPayload } from './types.js'

export class DuctumApiError extends Error {
  readonly details?: unknown

  constructor(
    message: string,
    readonly status: number,
    details?: unknown,
  ) {
    super(redactPublicText(message))
    this.name = 'DuctumApiError'
    this.details = redactPublicOutput(details)
  }
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: unknown; allow404?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<T> {
  // #275: wrap network-level fetch failures (server not started, port
  // mismatch, DNS failure, high-CPU stalls) in an operator-actionable
  // message. The raw `TypeError: fetch failed` from undici tells the
  // operator nothing — they need to know to check `ductum start`, the
  // configured --api-url, and whether the port is listening.
  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method ?? 'GET',
      headers: requestHeaders(init.body !== undefined, init.env ?? process.env),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch (error) {
    throw new DuctumApiError(formatFetchError(error, baseUrl, init.env ?? process.env), 0)
  }
  if (init.allow404 && response.status === 404) return null as T

  const text = await response.text()
  const json = text === '' ? null : (JSON.parse(text) as unknown)
  if (!response.ok) {
    const structured = readStructuredError(json)
    if (structured != null) {
      throw new DuctumApiError(structured.message, response.status, redactPublicOutput(json))
    }
    const payload = (json ?? {}) as Partial<ApiErrorPayload>
    throw new DuctumApiError(
      typeof payload.error === 'string' ? payload.error : `API request failed with status ${response.status}`,
      response.status,
      redactPublicOutput(payload.details),
    )
  }
  return json as T
}

/**
 * #275: produce an operator-actionable message for fetch-level failures.
 * Names the API URL, the most likely causes (server not started, wrong
 * --api-url, high-CPU stall), and the operator repair hints. Stays
 * short so it composes cleanly with `formatError` redaction.
 */
function formatFetchError(error: unknown, baseUrl: string, env: Record<string, string | undefined>): string {
  const cause = error instanceof Error ? error.message : String(error)
  const hint = 'Ductum API unreachable — is `ductum start` running? Check the configured --api-url and operator token.'
  return `${hint} (url: ${baseUrl.replace(/\/+$/, '')}, cause: ${cause || 'unknown'})`
}

function readStructuredError(value: unknown): { message: string } | null {
  if (value == null || typeof value !== 'object') return null
  const envelope = value as Record<string, unknown>
  if (envelope.kind !== 'error') return null
  const data = envelope.data
  if (data == null || typeof data !== 'object') return null
  const message = (data as Record<string, unknown>).message
  return typeof message === 'string' ? { message } : null
}

export function pathWithQuery(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query === '' ? path : `${path}?${query}`
}

function requestHeaders(hasBody: boolean, env: Record<string, string | undefined>): Record<string, string> | undefined {
  const headers: Record<string, string> = hasBody ? { 'content-type': 'application/json' } : {}
  Object.assign(headers, operatorTokenHeaders(env))
  return Object.keys(headers).length === 0 ? undefined : headers
}

export function operatorTokenHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const token = env.DUCTUM_OPERATOR_TOKEN?.trim()
  if (token == null || token === '' || isPlaceholderToken(token)) return {}
  return { 'x-ductum-operator-token': token }
}

function isPlaceholderToken(token: string): boolean {
  return ['missing', 'changeme', 'replace-me', 'local-demo-token'].includes(token.toLowerCase())
}
