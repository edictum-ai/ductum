import { componentFromTarget, createId, repositoryFromTarget } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError } from '../lib/errors.js'
import {
  normalizeComponentInput,
  normalizeRepositoryInput,
  normalizeRepositorySpec,
  repositoryLegacyRef,
} from '../lib/repositories.js'
import { optionalRecord, optionalString, readJson } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'
import { validateRepositoryAuthRef } from '../lib/repository-auth.js'

export function registerRepositoryRoutes(app: Hono, context: ApiContext) {
  app.get('/api/projects/:projectId/repositories', (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    return c.json(publicOutput(listRepositoriesWithTargetBridge(context, projectId as never)))
  })

  app.post('/api/projects/:projectId/repositories', async (c) => {
    const projectId = c.req.param('projectId')
    const project = context.repos.projects.get(projectId as never)
    if (project == null) throw new NotFoundError(`Project not found: ${projectId}`)
    const input = normalizeRepositoryInput(await readJson<Record<string, unknown>>(c), 'repository')
    validateRepositoryAuthRef(context, project.id, input.spec.authRef)
    const repository = context.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: input.name,
      spec: input.spec,
    })
    for (const component of input.components) {
      context.repos.components.create({
        id: createId<'ComponentId'>() as never,
        repositoryId: repository.id,
        name: component.name,
        spec: component.spec,
      })
    }
    syncProjectRepos(context, project.id)
    return c.json(publicOutput(repositoryWithComponents(context, repository.id)), 201)
  })

  app.get('/api/repositories/:id', (c) => {
    return c.json(publicOutput(repositoryWithComponents(context, c.req.param('id') as never)))
  })

  app.put('/api/repositories/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const repository = context.repos.repositories.get(c.req.param('id') as never)
    if (repository == null) throw new NotFoundError(`Repository not found: ${c.req.param('id')}`)
    const spec = body.spec == null ? undefined : normalizeRepositorySpec(body.spec)
    validateRepositoryAuthRef(context, repository.projectId, spec?.authRef)
    const updated = context.repos.repositories.update(repository.id, {
      name: optionalString(body.name, 'name'),
      spec,
    })
    syncProjectRepos(context, updated.projectId)
    return c.json(publicOutput(repositoryWithComponents(context, updated.id)))
  })

  app.delete('/api/repositories/:id', (c) => {
    const repository = context.repos.repositories.get(c.req.param('id') as never)
    if (repository == null) throw new NotFoundError(`Repository not found: ${c.req.param('id')}`)
    context.repos.repositories.delete(repository.id)
    syncProjectRepos(context, repository.projectId)
    return c.body(null, 204)
  })

  app.get('/api/repositories/:id/components', (c) => {
    const repository = context.repos.repositories.get(c.req.param('id') as never)
    if (repository == null) throw new NotFoundError(`Repository not found: ${c.req.param('id')}`)
    return c.json(publicOutput(context.repos.components.list(repository.id)))
  })

  app.post('/api/repositories/:id/components', async (c) => {
    const repository = context.repos.repositories.get(c.req.param('id') as never)
    if (repository == null) throw new NotFoundError(`Repository not found: ${c.req.param('id')}`)
    const input = normalizeComponentInput(await readJson<Record<string, unknown>>(c))
    const component = context.repos.components.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: input.name,
      spec: input.spec,
    })
    return c.json(publicOutput(component), 201)
  })

  app.put('/api/components/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const component = context.repos.components.get(c.req.param('id') as never)
    if (component == null) throw new NotFoundError(`Component not found: ${c.req.param('id')}`)
    const name = optionalString(body.name, 'name')
    const rawSpec = optionalRecord(body.spec, 'spec')
    const spec = rawSpec == null ? undefined : normalizeComponentInput({ name: name ?? component.name, ...rawSpec }).spec
    return c.json(publicOutput(context.repos.components.update(component.id, { name, spec })))
  })

  app.delete('/api/components/:id', (c) => {
    context.repos.components.delete(c.req.param('id') as never)
    return c.body(null, 204)
  })
}

function repositoryWithComponents(context: ApiContext, id: Parameters<ApiContext['repos']['repositories']['get']>[0]) {
  const repository = context.repos.repositories.get(id)
  if (repository == null) {
    const target = context.repos.targets.get(id as never)
    if (target == null) throw new NotFoundError(`Repository not found: ${id}`)
    const component = componentFromTarget(target)
    return { ...repositoryFromTarget(target), components: component == null ? [] : [component] }
  }
  return { ...repository, components: context.repos.components.list(repository.id) }
}

function listRepositoriesWithTargetBridge(
  context: ApiContext,
  projectId: Parameters<ApiContext['repos']['repositories']['list']>[0],
) {
  const repositories = context.repos.repositories.list(projectId)
  const targetRefs = new Set(repositories.map((repo) => repo.spec.targetRef).filter((id): id is NonNullable<typeof id> => id != null))
  const bridged = context.repos.targets.list(projectId)
    .filter((target) => !targetRefs.has(target.id))
    .map((target) => {
      const component = componentFromTarget(target)
      return { ...repositoryFromTarget(target), components: component == null ? [] : [component] }
    })
  return [
    ...repositories.map((repository) => ({ ...repository, components: context.repos.components.list(repository.id) })),
    ...bridged,
  ]
}

function syncProjectRepos(context: ApiContext, projectId: Parameters<ApiContext['repos']['projects']['get']>[0]): void {
  const project = context.repos.projects.get(projectId)
  if (project == null) return
  const repos = context.repos.repositories.list(project.id).map(repositoryLegacyRef)
  context.repos.projects.update(project.id, { repos })
}
