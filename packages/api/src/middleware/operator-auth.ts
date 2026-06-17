import { timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'

export function registerOperatorAuth(app: Hono, context: ApiContext) {
  app.use('/api/*', async (c, next) => {
    const token = context.operatorToken?.trim()
    if (token == null || token === '' || isPublicOrSessionScoped(c.req.path)) {
      await next()
      return
    }

    const supplied = readToken(c)
    if (supplied != null && tokensMatch(token, supplied)) {
      await next()
      return
    }
    return c.json({ error: 'Operator token required' }, 401)
  })
}

function isPublicOrSessionScoped(path: string): boolean {
  return path === '/api/health' || path.startsWith('/api/internal/') || path === '/api/telegram/webhook'
}

function readToken(c: Context): string | null {
  const explicit = c.req.header('x-ductum-operator-token')
  if (explicit != null && explicit !== '') return explicit
  const authorization = c.req.header('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
  const queryToken = c.req.query('ductum_operator_token')
  if (queryToken != null && queryToken !== '') return queryToken
  return readCookie(c.req.header('cookie') ?? '', 'ductum_operator_token')
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

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
