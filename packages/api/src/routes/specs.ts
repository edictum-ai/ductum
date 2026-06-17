import type { Hono } from 'hono'
import { createId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalNumber, optionalString, readJson, requireArray, requireString } from '../lib/http.js'
import {
  optionalDependencyKind,
  optionalSpecStatus,
  parseImportedTask,
  parseSpecStatus,
} from '../lib/parsers.js'
import { publicOutput } from '../lib/public-output.js'
import { deleteSpecCascading } from '../lib/spec-ops.js'

export function registerSpecRoutes(app: Hono, context: ApiContext) {
  app.get('/api/projects/:projectId/specs', (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    return c.json(publicOutput(context.repos.specs.list(projectId as never)))
  })

  app.post('/api/projects/:projectId/specs', async (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const maxFixRaw = optionalNumber(body.maxFixIterations, 'maxFixIterations')
    const maxFixIterations = (maxFixRaw != null && Number.isInteger(maxFixRaw) && maxFixRaw > 0)
      ? maxFixRaw
      : null
    const spec = context.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: projectId as never,
      name: requireString(body.name, 'name'),
      status: optionalSpecStatus(body.status, 'status') ?? 'draft',
      document: optionalString(body.document, 'document') ?? '',
      maxFixIterations,
    })
    return c.json(publicOutput(spec), 201)
  })

  app.post('/api/projects/:projectId/specs/import', async (c) => {
    const projectId = c.req.param('projectId')
    if (context.repos.projects.get(projectId as never) == null) {
      throw new NotFoundError(`Project not found: ${projectId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const specBlock = body.spec == null || typeof body.spec !== 'object' || Array.isArray(body.spec)
      ? undefined
      : (body.spec as Record<string, unknown>)
    const specName = optionalString(specBlock?.name, 'spec.name')
    if (!specName) throw new ValidationError('spec.name is required')
    const tasksRawList = requireArray(body.tasks, 'tasks')
    if (tasksRawList.length === 0) {
      throw new ValidationError('tasks must be a non-empty array')
    }
    const importedTasks = tasksRawList.map((entry, index) => parseImportedTask(entry, index))

    // Create spec
    const spec = context.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: projectId as never,
      name: specName,
      status: optionalSpecStatus(specBlock?.status, 'spec.status') ?? 'approved',
      document: optionalString(specBlock?.document, 'spec.document') ?? '',
      maxFixIterations: null,
    })

    // Create tasks with rollback on failure
    const taskMap: Record<string, string> = {}
    try {
      for (const imported of importedTasks) {
        const created = context.repos.tasks.create({
          id: createId<'TaskId'>(),
          specId: spec.id,
          targetId: null as never,
          name: imported.name,
          prompt: imported.prompt,
          repos: imported.repos,
          assignedAgentId: null as never,
          requiredRole: imported.requiredRole,
          complexity: null,
          status: 'pending',
          verification: imported.verification,
        })
        taskMap[imported.name] = created.id
      }
      // Wire dependencies
      for (const imported of importedTasks) {
        const taskId = taskMap[imported.name]
        if (taskId == null) continue
        for (const depName of imported.dependsOn) {
          const depId = taskMap[depName]
          if (depId != null) {
            context.repos.taskDependencies.add({ taskId: taskId as never, dependsOnId: depId as never })
          }
        }
      }
    } catch (err) {
      // Rollback: cascading delete removes spec + any tasks created so far
      await deleteSpecCascading(context, spec.id).catch(() => undefined)
      throw err
    }

    context.dag.evaluateTaskDAG(spec.id)
    return c.json(publicOutput({
      spec,
      taskCount: Object.keys(taskMap).length,
    }), 201)
  })

  app.get('/api/specs/:id', (c) => {
    const spec = context.repos.specs.get(c.req.param('id') as never)
    if (spec == null) {
      throw new NotFoundError(`Spec not found: ${c.req.param('id')}`)
    }
    return c.json(publicOutput(spec))
  })

  app.put('/api/specs/:id/status', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    return c.json(
      publicOutput(context.repos.specs.updateStatus(c.req.param('id') as never, parseSpecStatus(body.status, 'status'))),
    )
  })

  app.delete('/api/specs/:id', async (c) => {
    // Cascading delete — drops every run, run child row (activity,
    // updates, stage history, evidence, gate evaluations, session
    // mappings), task, and task dependency for the spec in a single
    // SQLite transaction. Live sessions are killed best-effort
    // before the DB rows disappear. Returns the counts so the UI
    // can confirm what was removed.
    const result = await deleteSpecCascading(context, c.req.param('id'))
    return c.json(publicOutput(result), 200)
  })

  app.get('/api/specs/:id/dependencies', (c) =>
    c.json(publicOutput(context.repos.specDependencies.list(c.req.param('id') as never))),
  )

  app.post('/api/specs/:id/dependencies', async (c) => {
    const specId = c.req.param('id')
    const body = await readJson<Record<string, unknown>>(c)
    const dependsOnId = requireString(body.dependsOnId, 'dependsOnId')
    if (specId === dependsOnId) {
      throw new ValidationError('Spec cannot depend on itself')
    }
    if (context.repos.specs.get(specId as never) == null) {
      throw new NotFoundError(`Spec not found: ${specId}`)
    }
    if (context.repos.specs.get(dependsOnId as never) == null) {
      throw new NotFoundError(`Spec not found: ${dependsOnId}`)
    }
    const kind = optionalDependencyKind(body.kind, 'kind') ?? 'hard'
    context.repos.specDependencies.add({ specId: specId as never, dependsOnId: dependsOnId as never, kind })
    return c.json(publicOutput({ specId, dependsOnId, kind }), 201)
  })

  app.delete('/api/specs/:id/dependencies/:depId', (c) => {
    context.repos.specDependencies.remove(c.req.param('id') as never, c.req.param('depId') as never)
    return c.body(null, 204)
  })
}
