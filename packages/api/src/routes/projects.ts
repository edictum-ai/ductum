import type { Hono } from 'hono'
import { createId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import {
  optionalRecord,
  optionalString,
  optionalStringArray,
  readJson,
  requireString,
} from '../lib/http.js'
import { getTaskExecutionIntegrityFieldsMap } from '../lib/execution-integrity.js'
import { repositoryLegacyRef } from '../lib/repositories.js'
import { validateRepositoryAuthRef } from '../lib/repository-auth.js'
import { listProjectRuns, optionalBoolean, projectRepositoriesFromBody } from '../project-route-support.js'
import { resolveStoredWorkflowSelection } from '../workflow-profiles.js'
import { publicOutput } from '../lib/public-output.js'

export function registerProjectRoutes(app: Hono, context: ApiContext) {
  app.get('/api/projects', (c) => {
    const factory = context.repos.factory.get()
    return c.json(publicOutput(factory == null ? [] : context.repos.projects.list(factory.id)))
  })

  app.post('/api/projects', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const factory = context.repos.factory.get()
    if (factory == null) throw new NotFoundError('Factory not found')
    const config = optionalRecord(body.config, 'config') ?? {}
    const onboardingRepositories = projectRepositoriesFromBody(body)
    for (const repo of onboardingRepositories) {
      validateRepositoryAuthRef(context, { projectId: null, authRef: repo.spec.authRef })
    }
    const repos = onboardingRepositories.length > 0
      ? onboardingRepositories.map((repo) => repo.name)
      : optionalStringArray(body.repos, 'repos') ?? []
    const workflowProfile = optionalString(config.workflowProfile, 'config.workflowProfile')
    const externalReviewRequired = optionalBoolean(config.externalReviewRequired, 'config.externalReviewRequired')
    const purpose = optionalProjectConfigText(config, 'purpose')
    const audience = optionalProjectConfigText(config, 'audience')
    const projectId = createId<'ProjectId'>()
    const project = context.db.transaction(() => {
      const project = context.repos.projects.create({
        id: projectId,
        factoryId: factory.id,
        name: requireString(body.name, 'name'),
        repos,
        config: {
          mergeMode: config.mergeMode === 'human' ? 'human' : 'auto',
          workflowPath: typeof config.workflowPath === 'string' ? config.workflowPath : 'workflows/coding-guard.yaml',
          externalReviewRequired,
          purpose,
          audience,
        },
      })
      const repositories = onboardingRepositories.map((repo) => {
        const repository = context.repos.repositories.create({
          id: createId<'RepositoryId'>() as never,
          projectId: project.id,
          name: repo.name,
          spec: repo.spec,
        })
        for (const component of repo.components) {
          context.repos.components.create({
            id: createId<'ComponentId'>() as never,
            repositoryId: repository.id,
            name: component.name,
            spec: component.spec,
          })
        }
        return repository
      })
      const compatibilityRepos = repositories.map(repositoryLegacyRef)
      const selected = workflowProfile == null
        ? null
        : resolveStoredWorkflowSelection({
            workflowProfile,
            projectId: project.id,
            repoNames: compatibilityRepos.length === 0 ? repos : compatibilityRepos,
            repoRoots: repositories
              .map((repository) => repository.spec.localPath)
              .filter((path): path is string => typeof path === 'string' && path !== ''),
            configResources: context.repos.configResources,
          })
      return context.repos.projects.update(project.id, {
        repos: compatibilityRepos.length === 0 ? undefined : compatibilityRepos,
        config: {
          ...project.config,
          ...(selected == null ? {} : selected),
        },
      })
    })()
    return c.json(publicOutput(project), 201)
  })

  app.get('/api/projects/:id', (c) => {
    const project = context.repos.projects.get(c.req.param('id') as never)
    if (project == null) {
      throw new NotFoundError(`Project not found: ${c.req.param('id')}`)
    }
    return c.json(publicOutput(project))
  })

  app.put('/api/projects/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const current = context.repos.projects.get(c.req.param('id') as never)
    if (current == null) {
      throw new NotFoundError(`Project not found: ${c.req.param('id')}`)
    }
    const config = optionalRecord(body.config, 'config')
    const repos = optionalStringArray(body.repos, 'repos') ?? current.repos
    const workflowProfile = config == null ? undefined : optionalString(config.workflowProfile, 'config.workflowProfile')
    const externalReviewRequired = config == null
      ? undefined
      : optionalBoolean(config.externalReviewRequired, 'config.externalReviewRequired')
    const purpose = config == null || !('purpose' in config)
      ? current.config.purpose
      : optionalProjectConfigText(config, 'purpose')
    const audience = config == null || !('audience' in config)
      ? current.config.audience
      : optionalProjectConfigText(config, 'audience')
    const updated = context.db.transaction(() => context.repos.projects.update(current.id, {
        name: optionalString(body.name, 'name'),
        repos: optionalStringArray(body.repos, 'repos'),
        config:
          config == null
            ? undefined
            : (() => {
                const selected = workflowProfile == null
                  ? null
                  : resolveStoredWorkflowSelection({
                      workflowProfile,
                      projectId: current.id,
                      repoNames: repos,
                      repoRoots: context.repos.repositories
                        .list(current.id)
                        .map((repository) => repository.spec.localPath)
                        .filter((path): path is string => typeof path === 'string' && path !== ''),
                      configResources: context.repos.configResources,
                    })
                return {
                  mergeMode: config.mergeMode == null ? current.config.mergeMode : config.mergeMode === 'human' ? 'human' : 'auto',
                  workflowPath: typeof config.workflowPath === 'string' ? config.workflowPath : current.config.workflowPath,
                  workflowProfile: selected?.workflowProfile ?? current.config.workflowProfile,
                  workflowProfileRef: selected?.workflowProfileRef ?? current.config.workflowProfileRef,
                  externalReviewRequired: externalReviewRequired == null ? current.config.externalReviewRequired : externalReviewRequired,
                  purpose,
                  audience,
                }
              })(),
      }))()
    return c.json(publicOutput(updated))
  })

  app.delete('/api/projects/:id', (c) => {
    context.repos.projects.delete(c.req.param('id') as never)
    return c.body(null, 204)
  })

  app.get('/api/projects/:id/agents', (c) => {
    const projectId = c.req.param('id')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    return c.json(publicOutput(context.repos.projectAgents.list(projectId as never)))
  })

  app.post('/api/projects/:id/agents', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const projectId = c.req.param('id')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const agentId = requireString(body.agentId, 'agentId')
    if (context.repos.agents.get(agentId as never) == null) {
      throw new NotFoundError(`Agent not found: ${agentId}`)
    }
    const validRoles = ['builder', 'reviewer', 'docs', 'watcher']

    const rolesArray = optionalStringArray(body.roles, 'roles') ?? []
    const singleRole = optionalString(body.role, 'role')
    const roles: string[] = rolesArray.length > 0 ? rolesArray : [singleRole ?? 'builder']

    for (const role of roles) {
      if (!validRoles.includes(role)) {
        throw new ValidationError(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`)
      }
      context.repos.projectAgents.assign({
        projectId: projectId as never,
        agentId: agentId as never,
        role: role as never,
      })
    }
    return c.json(publicOutput({ projectId, agentId, roles }), 201)
  })

  app.delete('/api/projects/:id/agents/:agentId', (c) => {
    const projectId = c.req.param('id')
    const role = c.req.query('role')
    context.repos.projectAgents.unassign(
      projectId as never,
      c.req.param('agentId') as never,
      role == null || role === '' ? undefined : (role as never),
    )
    return c.body(null, 204)
  })

  app.get('/api/projects/:id/runs', (c) => {
    const projectId = c.req.param('id')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    return c.json(publicOutput(listProjectRuns(context, projectId)))
  })

  app.get('/api/projects/:id/tasks', (c) => {
    const projectId = c.req.param('id')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const specs = context.repos.specs.list(projectId as never)
    const specById = new Map(specs.map((spec) => [spec.id, spec] as const))
    const tasks = context.repos.tasks.listBySpecIds(specs.map((spec) => spec.id))
    const integrityByTaskId = getTaskExecutionIntegrityFieldsMap(context, tasks, specById)
    return c.json(publicOutput(tasks.map((task) => ({
      ...task,
      ...integrityByTaskId.get(task.id)!,
    }))))
  })
}

function optionalProjectConfigText(config: Record<string, unknown>, key: 'purpose' | 'audience'): string | undefined {
  const value = optionalString(config[key], `config.${key}`)
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? undefined : trimmed
}
