import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { listAuditLog } from '../lib/audit-log.js'
import { optionalNumber, optionalString } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

export function registerAuditLogRoutes(app: Hono, context: ApiContext) {
  app.get('/api/audit-log', (c) => c.json(publicOutput(listAuditLog(context, {
    actor: optionalString(c.req.query('actor'), 'actor'),
    projectId: optionalString(c.req.query('projectId'), 'projectId'),
    project: optionalString(c.req.query('project'), 'project'),
    specId: optionalString(c.req.query('specId'), 'specId'),
    taskId: optionalString(c.req.query('taskId'), 'taskId'),
    runId: optionalString(c.req.query('runId'), 'runId'),
    eventType: optionalString(c.req.query('eventType'), 'eventType'),
    status: optionalString(c.req.query('status'), 'status'),
    from: optionalString(c.req.query('from'), 'from'),
    to: optionalString(c.req.query('to'), 'to'),
    limit: numberQuery(c.req.query('limit')),
    cursor: optionalString(c.req.query('cursor'), 'cursor'),
  }))))
}

function numberQuery(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined
  return optionalNumber(Number(value), 'limit')
}
