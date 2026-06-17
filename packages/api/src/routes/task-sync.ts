import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalString, readJson } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

export function registerTaskSyncRoutes(app: Hono, context: ApiContext) {
  app.put('/api/tasks/:id/prompt', async (c) => {
    const taskId = c.req.param('id')
    if (context.repos.tasks.get(taskId as never) == null) {
      throw new NotFoundError(`Task not found: ${taskId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    if (!Object.prototype.hasOwnProperty.call(body, 'prompt')) {
      throw new ValidationError('prompt is required')
    }
    const prompt = optionalString(body.prompt, 'prompt')
    const updated = context.repos.tasks.updatePrompt(taskId as never, prompt ?? '')
    context.dag.evaluateTaskDAG(updated.specId)
    return c.json(publicOutput(updated))
  })
}
