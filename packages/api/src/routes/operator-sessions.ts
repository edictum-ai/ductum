import type { Hono } from 'hono'
import type { OperatorSessionScope, ProjectId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalString, optionalStringArray, readJson } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'
import { getOperatorAuth } from '../middleware/operator-auth.js'
import { serializeOperatorCookie, shouldUseSecureCookie } from '../lib/operator-session.js'

const SCOPES = new Set<OperatorSessionScope>(['read', 'approver', 'operator'])

export function registerOperatorSessionRoutes(app: Hono, context: ApiContext) {
  app.get('/api/operator/session', (c) => {
    const auth = getOperatorAuth(c)
    return c.json(publicOutput({
      authenticated: auth != null,
      kind: auth?.kind ?? 'none',
      sessionId: auth?.kind === 'browser-session' ? auth.id : null,
      actor: auth?.actor ?? null,
      scopes: auth?.scopes ?? [],
      projectIds: auth?.projectIds ?? null,
    }))
  })

  app.get('/api/operator/sessions', (c) => {
    return c.json(publicOutput({ sessions: context.operatorSessions.list(context.now().getTime()) }))
  })

  app.post('/api/operator/sessions', async (c) => {
    const operatorToken = context.operatorToken?.trim()
    if (operatorToken == null || operatorToken === '') throw new ConflictError('Operator token is not configured')
    const body: Record<string, unknown> = await readJson<Record<string, unknown>>(c).catch(() => ({}))
    const minted = context.operatorSessions.mint({
      operatorToken,
      nowMs: context.now().getTime(),
      actor: actorForNewSession(getOperatorAuth(c), optionalString(body.actor, 'actor')),
      scopes: scopesFromBody(body.scopes),
      projectIds: projectIdsFromBody(body.projectIds),
    })
    if (body.makeCurrent !== false) {
      c.header('Set-Cookie', serializeOperatorCookie(
        minted.sessionId,
        shouldUseSecureCookie(c),
        Math.ceil((minted.expiresAtMs - context.now().getTime()) / 1000),
      ))
    }
    return c.json(publicOutput({ session: minted.session, current: body.makeCurrent !== false }), 201)
  })

  app.delete('/api/operator/sessions/:id', (c) => {
    const revoked = context.operatorSessions.revokeById(c.req.param('id'), context.now().getTime())
    if (revoked == null) throw new NotFoundError('Operator session not found')
    return c.json(publicOutput({ session: revoked }))
  })
}

function actorForNewSession(auth: ReturnType<typeof getOperatorAuth>, requested: string | null | undefined): string | undefined {
  if (auth?.kind === 'operator-token') return requested ?? 'operator-token'
  if (auth?.kind === 'browser-session') return auth.actor
  return undefined
}

function scopesFromBody(value: unknown): OperatorSessionScope[] {
  const scopes = optionalStringArray(value, 'scopes') ?? ['operator']
  const invalid = scopes.filter((scope) => !SCOPES.has(scope as OperatorSessionScope))
  if (invalid.length > 0) throw new ValidationError(`Unsupported operator session scopes: ${invalid.join(', ')}`)
  return [...new Set(scopes)] as OperatorSessionScope[]
}

function projectIdsFromBody(value: unknown): ProjectId[] | null {
  if (value == null) return null
  const projectIds = optionalStringArray(value, 'projectIds') ?? []
  return projectIds.length === 0 ? null : [...new Set(projectIds)] as ProjectId[]
}
