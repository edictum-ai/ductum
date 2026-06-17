import type { Hono } from 'hono'

import { shortId } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError } from '../lib/errors.js'
import { publicOutput } from '../lib/public-output.js'
import { decorateRunWithUi } from '../lib/run-ui-context.js'

/**
 * Slug-based resolution routes.
 *
 * The dashboard uses human-readable URL paths (/:project/:spec/:task/:shortId).
 * These endpoints resolve slug paths to full IDs so the dashboard can then
 * call the standard ID-based API.
 */
export function registerResolveRoutes(app: Hono, context: ApiContext) {
  /**
   * Reverse resolve: given a full run id, return the canonical
   * { project, spec, task, run } context. Powers the dashboard
   * `/runs/:runId` deep-link route emitted by the CLI. Registered
   * before the slug-shaped `/api/resolve/:project/...` routes so
   * `runs` does not get parsed as a project name.
   */
  app.get('/api/resolve/runs/:runId', (c) => {
    const runId = c.req.param('runId')
    const run = context.repos.runs.get(runId as never)
    if (run == null) throw new NotFoundError(`Run not found: ${runId}`)
    const task = context.repos.tasks.get(run.taskId as never)
    if (task == null) throw new NotFoundError(`Task not found for run ${runId}`)
    const spec = context.repos.specs.get(task.specId as never)
    if (spec == null) throw new NotFoundError(`Spec not found for run ${runId}`)
    const project = context.repos.projects.get(spec.projectId as never)
    if (project == null) throw new NotFoundError(`Project not found for run ${runId}`)
    return c.json(publicOutput({ project, spec, task, run: decorateRunWithUi(context, run) }))
  })

  /** Resolve project by name → { project } */
  app.get('/api/resolve/:project', (c) => {
    const project = resolveProject(context, c.req.param('project'))
    return c.json(publicOutput({ project }))
  })

  /** Resolve spec by project + spec name → { project, spec } */
  app.get('/api/resolve/:project/:spec', (c) => {
    const project = resolveProject(context, c.req.param('project'))
    const spec = resolveSpec(context, project.id, c.req.param('spec'))
    return c.json(publicOutput({ project, spec }))
  })

  /** Resolve task by project + spec + task name → { project, spec, task } */
  app.get('/api/resolve/:project/:spec/:task', (c) => {
    const project = resolveProject(context, c.req.param('project'))
    const spec = resolveSpec(context, project.id, c.req.param('spec'))
    const task = resolveTask(context, spec.id, c.req.param('task'))
    return c.json(publicOutput({ project, spec, task }))
  })

  /** Resolve run by project + spec + task + short ID → { project, spec, task, run } */
  app.get('/api/resolve/:project/:spec/:task/:shortId', (c) => {
    const project = resolveProject(context, c.req.param('project'))
    const spec = resolveSpec(context, project.id, c.req.param('spec'))
    const task = resolveTask(context, spec.id, c.req.param('task'))
    const run = resolveRun(context, task.id, c.req.param('shortId'))
    return c.json(publicOutput({ project, spec, task, run: decorateRunWithUi(context, run) }))
  })
}

function resolveProject(context: ApiContext, name: string) {
  const factory = context.repos.factory.get()
  if (factory == null) throw new NotFoundError('Factory not found')
  const projects = context.repos.projects.list(factory.id)
  const project = projects.find((p) => p.name === name)
  if (project == null) throw new NotFoundError(`Project not found: ${name}`)
  return project
}

function resolveSpec(context: ApiContext, projectId: string, name: string) {
  const specs = context.repos.specs.list(projectId as never)
  const spec = specs.find((s) => s.name === name)
  if (spec == null) throw new NotFoundError(`Spec not found: ${name}`)
  return spec
}

function resolveTask(context: ApiContext, specId: string, name: string) {
  const tasks = context.repos.tasks.list(specId as never)
  const task = tasks.find((t) => t.name === name)
  if (task == null) throw new NotFoundError(`Task not found: ${name}`)
  return task
}

function resolveRun(context: ApiContext, taskId: string, shortRunId: string) {
  const runs = context.repos.runs.list(taskId as never)
  const run = runs.find((r) => shortId(r.id) === shortRunId)
  if (run == null) throw new NotFoundError(`Run not found: ${shortRunId}`)
  return run
}
