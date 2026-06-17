import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { publicEvidence, publicGateEvaluation } from '../lib/public-output.js'

export function registerEvidenceRoutes(app: Hono, context: ApiContext) {
  app.get('/api/runs/:id/evidence', (c) =>
    c.json(context.repos.evidence.list(c.req.param('id') as never).map(publicEvidence)),
  )

  app.get('/api/runs/:id/gate-evaluations', (c) =>
    c.json(context.repos.gateEvaluations.list(c.req.param('id') as never).map(publicGateEvaluation)),
  )
}
