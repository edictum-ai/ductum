import { timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'
import type { OperatorSessionScope, ProjectId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { readOperatorCookie, type AuthenticatedOperatorSession } from '../lib/operator-session.js'
import { SESSION_CONTROL_TOKEN_HEADER } from '../lib/session-control.js'

const OPERATOR_AUTH_CONTEXT_KEY = 'ductum.operatorAuth'

export interface OperatorAuthContext extends AuthenticatedOperatorSession {
  kind: 'operator-token' | 'browser-session'
}

export function registerOperatorAuth(app: Hono, context: ApiContext) {
  app.use('/api/*', async (c, next) => {
    const token = context.operatorToken?.trim()
    if (token == null || token === '' || isPublicOrSelfAuthenticating(c.req.path) || hasValidMcpControlToken(c, context)) {
      await next()
      return
    }

    const auth = authenticateOperatorAuth(c, context, token)
    if (auth == null) return c.json({ error: 'Operator token required' }, 401)
    setOperatorAuth(c, auth)
    const scopeFailure = authorizeOperatorRequest(c, context, auth)
    if (scopeFailure != null) return scopeFailure
    await next()
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

  const auth = getOperatorAuth(c) ?? authenticateOperatorAuth(c, context, token)
  if (auth != null && hasScope(auth, 'operator')) return null
  return c.json(
    {
      error:
        'Unattended approval that can merge or push requires operator authentication. Retry with x-ductum-operator-token or an operator-scoped browser session.',
    },
    401,
  )
}

export function getOperatorAuth(c: Context): OperatorAuthContext | null {
  const value = (c as unknown as { get: (key: string) => unknown }).get(OPERATOR_AUTH_CONTEXT_KEY)
  return value == null ? null : value as OperatorAuthContext
}

function setOperatorAuth(c: Context, auth: OperatorAuthContext): void {
  ;(c as unknown as { set: (key: string, value: unknown) => void }).set(OPERATOR_AUTH_CONTEXT_KEY, auth)
}

function authenticateOperatorAuth(c: Context, context: ApiContext, operatorToken: string): OperatorAuthContext | null {
  const explicit = readExplicitOperatorToken(c)
  if (explicit != null && tokensMatch(operatorToken, explicit)) {
    return { kind: 'operator-token', id: 'operator-token', actor: 'operator-token', scopes: ['operator'], projectIds: null }
  }
  const sessionId = readOperatorCookie(c.req.header('cookie') ?? '')
  if (sessionId == null) return null
  const session = context.operatorSessions.authenticate({
    sessionId,
    operatorToken,
    nowMs: context.now().getTime(),
  })
  return session == null ? null : { ...session, kind: 'browser-session' }
}

function authorizeOperatorRequest(c: Context, context: ApiContext, auth: OperatorAuthContext): Response | null {
  const required = requiredScope(c.req.method, c.req.path)
  if (!hasScope(auth, required)) {
    return c.json({ error: 'Operator session scope required', requiredScope: required, actor: auth.actor, scopes: auth.scopes }, 403)
  }
  const projectFailure = authorizeProjectScope(c, context, auth)
  if (projectFailure != null) return projectFailure
  return null
}

function requiredScope(method: string, path: string): OperatorSessionScope {
  if (path === '/api/operator/sessions' || path.startsWith('/api/operator/sessions/')) return 'operator'
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read'
  if (/^\/api\/runs\/[^/]+\/(approve|approve-rebase|reject)$/.test(path)) return 'approver'
  return 'operator'
}

function hasScope(auth: OperatorAuthContext, required: OperatorSessionScope): boolean {
  if (auth.scopes.includes('operator')) return true
  if (required === 'read') return auth.scopes.includes('read') || auth.scopes.includes('approver')
  return auth.scopes.includes(required)
}

function authorizeProjectScope(c: Context, context: ApiContext, auth: OperatorAuthContext): Response | null {
  if (auth.projectIds == null || auth.projectIds.length === 0) return null
  const projectId = inferProjectId(c, context)
  if (projectId === undefined && c.req.method === 'GET' && c.req.path === '/api/operator/session') return null
  if (projectId === undefined) {
    return c.json({ error: 'Operator session project scope cannot authorize this factory-wide route', actor: auth.actor, projectIds: auth.projectIds }, 403)
  }
  if (projectId != null && auth.projectIds.includes(projectId)) return null
  return c.json({ error: 'Operator session is not scoped to this project', actor: auth.actor, projectIds: auth.projectIds }, 403)
}

function isPublicOrSelfAuthenticating(path: string): boolean {
  return path === '/api/health'
    || path === '/api/telegram/webhook'
    || path === '/api/internal/session/reconnect'
    || path === '/api/internal/session/logout'
    || path === '/api/internal/operator-token-detect'
    || path === '/api/internal/welcome/exchange'
    || path === '/api/internal/authorize-tool'
    || path === '/api/internal/report-tool-success'
}

function hasValidMcpControlToken(c: Context, context: ApiContext): boolean {
  const runId = mcpRunIdFromPath(c.req.path)
  if (runId == null) return false
  const controlToken = c.req.header(SESSION_CONTROL_TOKEN_HEADER) ?? c.req.query('ductum_control_token') ?? ''
  if (controlToken === '') return false
  const mapping = context.repos.sessionRunMappings.getByRunId(runId as never)
  return mapping != null && tokensMatch(mapping.controlToken, controlToken)
}

function inferProjectId(c: Context, context: ApiContext): ProjectId | null | undefined {
  const parts = c.req.path.slice('/api/'.length).split('/')
  if (parts[0] === 'operator' && parts[1] === 'session') return undefined
  if (parts[0] === 'operator' && parts[1] === 'sessions') return null
  if (parts[0] === 'factory' && parts[1] === 'secrets') return projectIdForSecret(c, context, parts[2])
  if (parts[0] === 'resolve') return projectIdForResolvePath(context, parts)
  if (factoryScopedPath(parts)) return null
  if (parts[0] === 'projects' && parts[1] != null) return decodePart(parts[1]) as ProjectId
  if (parts[0] === 'specs' && parts[1] != null) return context.repos.specs.get(decodePart(parts[1]) as never)?.projectId
  if (parts[0] === 'tasks' && parts[1] != null) return projectIdForTask(context, decodePart(parts[1]))
  if (parts[0] === 'runs' && parts[1] != null) return projectIdForRun(context, decodePart(parts[1]))
  if (parts[0] === 'attempts' && parts[1] != null) return projectIdForRun(context, decodePart(parts[1]))
  if (parts[0] === 'repositories' && parts[1] != null) {
    return context.repos.repositories.get(decodePart(parts[1]) as never)?.projectId
  }
  if (parts[0] === 'components' && parts[1] != null) {
    const component = context.repos.components.get(decodePart(parts[1]) as never)
    return component == null ? undefined : context.repos.repositories.get(component.repositoryId)?.projectId
  }
  if (parts[0] === 'resources' && parts[2] != null) return context.repos.configResources.get(decodePart(parts[2]) as never)?.projectId ?? null
  return undefined
}

function projectIdForResolvePath(context: ApiContext, parts: string[]): ProjectId | undefined {
  if (parts[1] === 'runs' && parts[2] != null) return projectIdForRun(context, decodePart(parts[2]))
  if (parts[1] == null) return undefined
  const rawProject = decodePart(parts[1])
  const factory = context.repos.factory.get()
  if (factory == null) return undefined
  const project = context.repos.projects.list(factory.id).find((item) => item.name === rawProject || item.id === rawProject)
  return project?.id
}

function projectIdForTask(context: ApiContext, taskId: string): ProjectId | undefined {
  const task = context.repos.tasks.get(taskId as never)
  return task == null ? undefined : context.repos.specs.get(task.specId)?.projectId
}

function projectIdForRun(context: ApiContext, runId: string): ProjectId | undefined {
  const run = context.repos.runs.get(runId as never)
  return run == null ? undefined : projectIdForTask(context, run.taskId)
}

function projectIdForSecret(c: Context, context: ApiContext, rawId: string | undefined): ProjectId | null | undefined {
  if (rawId != null) return context.repos.secrets.get(decodePart(rawId))?.projectId ?? null
  const queryProjectId = c.req.query('projectId')
  if (queryProjectId == null || queryProjectId === 'factory') return null
  return queryProjectId as ProjectId
}

function factoryScopedPath(parts: string[]): boolean {
  return parts[0] === 'factory'
    || parts[0] === 'factory-settings'
    || parts[0] === 'agents'
    || parts[0] === 'models'
    || parts[0] === 'repair'
    || parts[0] === 'audit-log'
    || parts[0] === 'audit-bundle'
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
  return null
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}
