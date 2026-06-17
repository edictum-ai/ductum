import { createId } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { normalizeConfigResourceSpec, parseConfigResourceKind } from '../lib/config-resources.js'
import { NotFoundError } from '../lib/errors.js'
import { optionalString, readJson, requireString } from '../lib/http.js'
import { publicConfigResource } from '../lib/public-output.js'
import { assertKnownSecretRefs } from '../lib/secret-refs.js'

export function registerConfigResourceRoutes(app: Hono, context: ApiContext) {
  app.get('/api/resources/:kind', (c) => {
    const kind = parseConfigResourceKind(c.req.param('kind'))
    const projectId = c.req.query('projectId')
    return c.json(context.repos.configResources.list({
      kind,
      ...(projectId == null ? {} : { projectId: projectId === 'factory' ? null : projectId as never }),
    }).map(publicConfigResource))
  })

  app.post('/api/resources/:kind', async (c) => {
    const kind = parseConfigResourceKind(c.req.param('kind'))
    const body = await readJson<Record<string, unknown>>(c)
    const projectId = optionalString(body.projectId, 'projectId') ?? null
    if (projectId != null && context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const spec = normalizeConfigResourceSpec(kind, body.spec)
    assertKnownSecretRefs(spec, 'spec', context.repos.secrets)
    const resource = context.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind,
      projectId: projectId as never,
      name: requireString(body.name, 'name'),
      spec,
    })
    return c.json(publicConfigResource(resource), 201)
  })

  app.get('/api/resources/:kind/:id', (c) => {
    const kind = parseConfigResourceKind(c.req.param('kind'))
    const resource = context.repos.configResources.get(c.req.param('id') as never)
    if (resource == null || resource.kind !== kind) {
      throw new NotFoundError(`Config resource not found: ${c.req.param('id')}`)
    }
    return c.json(publicConfigResource(resource))
  })

  app.put('/api/resources/:kind/:id', async (c) => {
    const kind = parseConfigResourceKind(c.req.param('kind'))
    const current = context.repos.configResources.get(c.req.param('id') as never)
    if (current == null || current.kind !== kind) {
      throw new NotFoundError(`Config resource not found: ${c.req.param('id')}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const projectId = optionalString(body.projectId, 'projectId')
    if (projectId != null && context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const spec = body.spec == null ? undefined : normalizeConfigResourceSpec(kind, body.spec)
    if (spec !== undefined) assertKnownSecretRefs(spec, 'spec', context.repos.secrets)
    return c.json(publicConfigResource(context.repos.configResources.update(current.id, {
      name: optionalString(body.name, 'name'),
      ...(body.projectId === undefined ? {} : { projectId: (projectId ?? null) as never }),
      spec,
    })))
  })

  app.delete('/api/resources/:kind/:id', (c) => {
    const kind = parseConfigResourceKind(c.req.param('kind'))
    const current = context.repos.configResources.get(c.req.param('id') as never)
    if (current == null || current.kind !== kind) {
      throw new NotFoundError(`Config resource not found: ${c.req.param('id')}`)
    }
    context.repos.configResources.delete(current.id)
    return c.body(null, 204)
  })
}
