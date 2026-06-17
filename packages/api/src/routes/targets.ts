import { createId } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError } from '../lib/errors.js'
import { normalizeTargetSpec } from '../lib/targets.js'
import { optionalString, readJson, requireString } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

export function registerTargetRoutes(app: Hono, context: ApiContext) {
  app.get('/api/projects/:projectId/targets', (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    return c.json(publicOutput(context.repos.targets.list(projectId as never)))
  })

  app.post('/api/projects/:projectId/targets', async (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const target = context.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: projectId as never,
      name: requireString(body.name, 'name'),
      spec: normalizeTargetSpec(body.spec),
    })
    return c.json(publicOutput(target), 201)
  })

  app.get('/api/targets/:id', (c) => {
    const target = context.repos.targets.get(c.req.param('id') as never)
    if (target == null) throw new NotFoundError(`Target not found: ${c.req.param('id')}`)
    return c.json(publicOutput(target))
  })

  app.put('/api/targets/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const target = context.repos.targets.get(c.req.param('id') as never)
    if (target == null) throw new NotFoundError(`Target not found: ${c.req.param('id')}`)
    return c.json(publicOutput(context.repos.targets.update(target.id, {
      name: optionalString(body.name, 'name'),
      spec: body.spec == null ? undefined : normalizeTargetSpec(body.spec),
    })))
  })

  app.delete('/api/targets/:id', (c) => {
    context.repos.targets.delete(c.req.param('id') as never)
    return c.body(null, 204)
  })
}
