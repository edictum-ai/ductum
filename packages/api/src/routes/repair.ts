import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { publicOutput } from '../lib/public-output.js'
import { buildApiRepairReport } from '../lib/repair.js'

export function registerRepairRoutes(app: Hono, context: ApiContext) {
  app.get('/api/repair', async (c) => c.json(publicOutput(await buildApiRepairReport(context))))
}
