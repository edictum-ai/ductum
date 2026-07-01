import { timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { readOperatorCookie } from '../lib/operator-session.js'
import { SESSION_CONTROL_TOKEN_HEADER } from '../lib/session-control.js'

export function registerOperatorAuth(app: Hono, context: ApiContext) {
  app.use('/api/*', async (c, next) => {
    const token = context.operatorToken?.trim()
    if (token == null || token === '' || isPublicOrInternal(c.req.path) || hasValidMcpControlToken(c, context)) {
      await next()
      return
    }

    if (hasValidOperatorAuth(c, context, token)) {
      await next()
      return
    }
    return c.json({ error: 'Operator token required' }, 401)
  })
}

export function requireUnattendedOperatorAuth(c: Context, context: ApiContext): Response | null {
  const token = context.operatorToken?.trim()
  if (token == null || token === '') {
    return c.json(
      {
        error:
          'Unattended approval that can merge or push requires operator authentication. Configure DUCTUM_OPERATOR_TOKEN, restart the API, then retry with x-ductum-operator-token or the operator session cookie.',
      },
      403,
    )
  }

  if (hasValidOperatorAuth(c, context, token)) return null
  return c.json(
    {
      error:
        'Unattended approval that can merge or push requires operator authentication. Retry with x-ductum-operator-token or the operator session cookie.',
    },
    401,
  )
}

function hasValidOperatorAuth(c: Context, context: ApiContext, operatorToken: string): boolean {
  const explicit = readExplicitOperatorToken(c)
  if (explicit != null && tokensMatch(operatorToken, explicit)) return true
  const sessionId = readOperatorCookie(c.req.header('cookie') ?? '')
  return sessionId != null && context.operatorSessions.validate({
    sessionId,
    operatorToken,
    nowMs: context.now().getTime(),
  })
}

function isPublicOrInternal(path: string): boolean {
  return path === '/api/health' || path.startsWith('/api/internal/') || path === '/api/telegram/webhook'
}

function hasValidMcpControlToken(c: Context, context: ApiContext): boolean {
  const runId = mcpRunIdFromPath(c.req.path)
  if (runId == null) return false
  const controlToken = c.req.header(SESSION_CONTROL_TOKEN_HEADER) ?? c.req.query('ductum_control_token') ?? ''
  if (controlToken === '') return false
  const mapping = context.repos.sessionRunMappings.getByRunId(runId as never)
  return mapping != null && tokensMatch(mapping.controlToken, controlToken)
}

function mcpRunIdFromPath(path: string): string | null {
  const prefix = '/api/mcp/'
  if (!path.startsWith(prefix)) return null
  const raw = path.slice(prefix.length)
  if (raw === '' || raw.includes('/')) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

function readExplicitOperatorToken(c: Context): string | null {
  const explicit = c.req.header('x-ductum-operator-token')
  if (explicit != null && explicit !== '') return explicit
  const authorization = c.req.header('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice('Bearer '.length)
  const queryToken = c.req.query('ductum_operator_token')
  if (queryToken != null && queryToken !== '') return queryToken
  return null
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
