import type { Hono } from 'hono'

import { buildAuditBundle } from '../lib/audit-bundle.js'
import type { ApiContext } from '../lib/deps.js'
import { optionalString } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

export function registerAuditBundleRoutes(app: Hono, context: ApiContext) {
  app.get('/api/audit-bundle', (c) =>
    c.json(publicOutput(buildAuditBundle(context, {
      runId: optionalString(c.req.query('runId'), 'runId'),
    }))),
  )

  app.get('/api/runs/:id/audit-bundle', (c) =>
    c.json(publicOutput(buildAuditBundle(context, { runId: c.req.param('id') }))),
  )
}
