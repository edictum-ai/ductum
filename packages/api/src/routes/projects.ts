import type { Hono } from 'hono'
import { createId, type Run } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import {
  optionalRecord,
  optionalString,
  optionalStringArray,
  readJson,
  requireString,
} from '../lib/http.js'
import {
  getRunExecutionIntegrityFieldsMap,
  getTaskExecutionIntegrityFieldsMap,
  type ExecutionIntegrityFields,
} from '../lib/execution-integrity.js'
import { buildRunUiContract, type RunUiContract } from '../lib/ui-contract.js'
import { normalizeRepositoryInput, repositoryLegacyRef } from '../lib/repositories.js'
import { normalizeWorkflowProfilePath } from '../workflow-profiles.js'
import { publicOutput } from '../lib/public-output.js'

interface ProjectRunRow {
  id: string
  task_name: string
  spec_name: string
  agent_name: string
  agent_model: string
  retry_count: number
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${field} must be a boolean`)
  }
  return value
}

function projectRepositoriesFromBody(body: Record<string, unknown>) {
  const repositories = body.repositories
  if (repositories != null) {
    if (!Array.isArray(repositories)) throw new ValidationError('repositories must be an array')
    return repositories.map((entry, index) => normalizeRepositoryInput(entry, `repositories[${index}]`))
  }
  if (body.repository != null) return [normalizeRepositoryInput(body.repository, 'repository')]
  return []
}

/** Enriched run row scoped to a single project. */
export interface ProjectRun extends ExecutionIntegrityFields {
  id: string
  taskId: string
  taskName: string
  specName: string
  agentId: string
  agentName: string
  agentModel: string
  retryCount: number
  stage: string
  terminalState: string | null
  pendingApproval: boolean
  failReason: string | null
  costUsd: number
  tokensIn: number
  tokensOut: number
  lastHeartbeat: string | null
  createdAt: string
  updatedAt: string
  ui: RunUiContract
}

/** Return all runs for tasks in specs belonging to the given project. */
export function listProjectRuns(context: ApiContext, projectId: string): ProjectRun[] {
  const project = context.repos.projects.get(projectId as never)
  if (project == null) return []

  const rows = context.db
    .prepare(
      `
        SELECT
          r.id,
          r.task_id,
          COALESCE(t.name, r.task_id) AS task_name,
          COALESCE(s.name, 'Unknown spec') AS spec_name,
          r.agent_id,
          COALESCE(a.name, r.agent_id) AS agent_name,
          COALESCE(a.model, '') AS agent_model,
          COALESCE(t.retry_count, 0) AS retry_count,
          r.stage,
          r.terminal_state,
          r.pending_approval,
          r.fail_reason,
          r.cost_usd,
          r.tokens_in,
          r.tokens_out,
          r.last_heartbeat,
          r.created_at,
          r.updated_at
        FROM runs r
        LEFT JOIN tasks t ON t.id = r.task_id
        LEFT JOIN specs s ON s.id = t.spec_id
        LEFT JOIN agents a ON a.id = r.agent_id
        WHERE s.project_id = ?
        ORDER BY r.created_at DESC
      `,
    )
    .all(projectId) as (ProjectRunRow & {
      task_id: string
      agent_id: string
      stage: string
      terminal_state: string | null
      pending_approval: number
      fail_reason: string | null
      cost_usd: number
      tokens_in: number
      tokens_out: number
      last_heartbeat: string | null
      created_at: string
      updated_at: string
    })[]
  const runsById = new Map(
    context.repos.runs.listByTaskIds([...new Set(rows.map((row) => row.task_id as Run['taskId']))]).map((run) => [run.id, run] as const),
  )
  const integrityByRunId = getRunExecutionIntegrityFieldsMap(context, [...runsById.values()])

  return rows.map((row) => {
    const run = runsById.get(row.id as never)!
    return {
      ...integrityByRunId.get(run.id)!,
      id: row.id,
      taskId: row.task_id,
      taskName: row.task_name,
      specName: row.spec_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentModel: row.agent_model,
      retryCount: row.retry_count,
      stage: row.stage,
      terminalState: row.terminal_state,
      pendingApproval: row.pending_approval === 1,
      failReason: row.fail_reason,
      costUsd: row.cost_usd,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      lastHeartbeat: row.last_heartbeat ? row.last_heartbeat.replace(' ', 'T') + 'Z' : null,
      createdAt: row.created_at.replace(' ', 'T') + 'Z',
      updatedAt: row.updated_at.replace(' ', 'T') + 'Z',
      ui: buildRunUiContract(run, {
        projectName: project.name,
        specName: row.spec_name,
        taskName: row.task_name,
      }),
    }
  })
}

export function registerProjectRoutes(app: Hono, context: ApiContext) {
  app.get('/api/projects', (c) => {
    const factory = context.repos.factory.get()
    return c.json(publicOutput(factory == null ? [] : context.repos.projects.list(factory.id)))
  })

  app.post('/api/projects', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const factory = context.repos.factory.get()
    if (factory == null) {
      throw new NotFoundError('Factory not found')
    }
    const config = optionalRecord(body.config, 'config') ?? {}
    const onboardingRepositories = projectRepositoriesFromBody(body)
    const repos = onboardingRepositories.length > 0
      ? onboardingRepositories.map((repo) => repo.name)
      : optionalStringArray(body.repos, 'repos') ?? []
    const workflowProfile = optionalString(config.workflowProfile, 'config.workflowProfile')
    const externalReviewRequired = optionalBoolean(
      config.externalReviewRequired,
      'config.externalReviewRequired',
    )
    const project = context.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: requireString(body.name, 'name'),
      repos,
      config: {
        mergeMode: config.mergeMode === 'human' ? 'human' : 'auto',
        workflowPath:
          typeof config.workflowPath === 'string' ? config.workflowPath : 'workflows/coding-guard.yaml',
        workflowProfile:
          workflowProfile == null
            ? undefined
            : normalizeWorkflowProfilePath(workflowProfile, repos),
        externalReviewRequired,
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
    return c.json(
      publicOutput(compatibilityRepos.length === 0 ? project : context.repos.projects.update(project.id, { repos: compatibilityRepos })),
      201,
    )
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
    return c.json(
      publicOutput(context.repos.projects.update(c.req.param('id') as never, {
        name: optionalString(body.name, 'name'),
        repos: optionalStringArray(body.repos, 'repos'),
        config:
          config == null
            ? undefined
            : {
                mergeMode:
                  config.mergeMode == null
                    ? current.config.mergeMode
                    : config.mergeMode === 'human'
                      ? 'human'
                      : 'auto',
                workflowPath:
                  typeof config.workflowPath === 'string'
                    ? config.workflowPath
                    : current.config.workflowPath,
                workflowProfile:
                  workflowProfile == null
                    ? current.config.workflowProfile
                    : normalizeWorkflowProfilePath(workflowProfile, repos),
                externalReviewRequired:
                  externalReviewRequired == null
                    ? current.config.externalReviewRequired
                    : externalReviewRequired,
              },
      })),
    )
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
