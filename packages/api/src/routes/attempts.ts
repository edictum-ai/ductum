import { operatorAttemptFromRun } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { enrichRuns, listEnrichedRuns, type EnrichedRun } from '../lib/enriched-runs.js'
import { NotFoundError } from '../lib/errors.js'
import { publicAttempt, publicOutput } from '../lib/public-output.js'

function attemptFromRun(context: ApiContext, run: Parameters<typeof operatorAttemptFromRun>[0]) {
  return attemptFromDecoratedRun(enrichRuns(context, [run])[0]!)
}

function attemptFromDecoratedRun(run: EnrichedRun) {
  const {
    parentRunId,
    ...transport
  } = run
  const attempt = operatorAttemptFromRun(run)
  return {
    ...transport,
    recordType: attempt.recordType,
    name: attempt.name,
    status: attempt.status,
    parentAttemptId: parentRunId,
    snapshot: attempt.snapshot,
    ui: run.ui,
  }
}

function attemptsFromRuns(runs: EnrichedRun[]) {
  return runs.map((run) => attemptFromDecoratedRun(run))
}

export function registerAttemptRoutes(app: Hono, context: ApiContext) {
  app.get('/api/attempts', (c) => {
    const stage = c.req.query('stage')
    const limit = c.req.query('limit')
    const attempts = attemptsFromRuns(
      listEnrichedRuns(context, {
        stage: stage || undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    ).map(publicAttempt)
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
      attempts: attemptsFromRuns(enrichRuns(context, context.repos.runs.list(taskId as never))).map(publicAttempt),
    }))
  })

  app.get('/api/attempts/:id', (c) => {
    const run = context.repos.runs.get(c.req.param('id') as never)
    if (run == null) throw new NotFoundError(`Attempt not found: ${c.req.param('id')}`)
    return c.json(publicAttempt(attemptFromRun(context, run)))
  })
}
