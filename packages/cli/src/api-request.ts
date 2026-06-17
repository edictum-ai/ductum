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
  init: { method?: string; body?: unknown; allow404?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: init.method ?? 'GET',
    headers: requestHeaders(init.body !== undefined),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
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

function requestHeaders(hasBody: boolean): Record<string, string> | undefined {
  const headers: Record<string, string> = hasBody ? { 'content-type': 'application/json' } : {}
  Object.assign(headers, operatorTokenHeaders(process.env))
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
