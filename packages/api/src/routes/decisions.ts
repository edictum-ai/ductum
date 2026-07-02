import type { Hono } from 'hono'
import { createId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { optionalString, optionalStringArray, readJson, requireString } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'
import { getOperatorAuth } from '../middleware/operator-auth.js'

export function registerDecisionRoutes(app: Hono, context: ApiContext) {
  app.get('/api/decisions', (c) =>
    c.json(
      publicOutput(context.repos.decisions.list({
        specId: c.req.query('specId') as never,
        taskId: c.req.query('taskId') as never,
        runId: c.req.query('runId') as never,
      })),
    ),
  )

  app.post('/api/decisions', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const decision = context.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: (optionalString(body.specId, 'specId') ?? null) as never,
      taskId: (optionalString(body.taskId, 'taskId') ?? null) as never,
      runId: (optionalString(body.runId, 'runId') ?? null) as never,
      decision: requireString(body.decision, 'decision'),
      context: requireString(body.context, 'context'),
      alternatives: optionalStringArray(body.alternatives, 'alternatives') ?? null,
      decidedBy: getOperatorAuth(c)?.actor ?? optionalString(body.decidedBy, 'decidedBy') ?? 'unknown-operator',
      supersedesId: (optionalString(body.supersedesId, 'supersedesId') ?? null) as never,
    })
    return c.json(publicOutput(decision), 201)
  })
}
