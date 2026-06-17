import { operatorAttemptFromRun } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError } from '../lib/errors.js'
import { publicAttempt, publicOutput } from '../lib/public-output.js'

export function registerAttemptRoutes(app: Hono, context: ApiContext) {
  app.get('/api/attempts', (c) => {
    const stage = c.req.query('stage')
    const limit = c.req.query('limit')
    const attempts = context.repos.runs
      .listAll({ stage: stage || undefined, limit: limit ? Number(limit) : undefined })
      .map((run) => publicAttempt(operatorAttemptFromRun(run)))
    return c.json(publicOutput({ recordType: 'Attempt', attempts }))
  })

  app.get('/api/tasks/:taskId/attempts', (c) => {
    const taskId = c.req.param('taskId')
    if (context.repos.tasks.get(taskId as never) == null) {
      throw new NotFoundError(`Task not found: ${taskId}`)
    }
    return c.json(publicOutput({
      recordType: 'Attempt',
      taskId,
      attempts: context.repos.runs.list(taskId as never).map((run) => publicAttempt(operatorAttemptFromRun(run))),
    }))
  })

  app.get('/api/attempts/:id', (c) => {
    const run = context.repos.runs.get(c.req.param('id') as never)
    if (run == null) throw new NotFoundError(`Attempt not found: ${c.req.param('id')}`)
    return c.json(publicAttempt(operatorAttemptFromRun(run)))
  })
}
