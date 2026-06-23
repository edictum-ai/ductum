import type { Hono } from 'hono'
import { createId, isPrimaryTaskExecutionIssueCode } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js'
import { getTaskExecutionIntegrityFields, getTaskExecutionIntegrityFieldsMap } from '../lib/execution-integrity.js'
import { optionalString, optionalStringArray, readJson, requireString } from '../lib/http.js'
import { evaluateTaskDAGAndKick } from '../lib/dispatch-kick.js'
import {
  optionalComplexity,
  optionalRequiredRole,
  optionalTaskStatus,
  parseTaskStatus,
} from '../lib/parsers.js'
import { publicOutput } from '../lib/public-output.js'
import { resolveTaskSourceScope } from '../lib/task-source-scope.js'

const TERMINAL_STAGES = new Set(['done', 'failed', 'stalled'])

export function registerTaskRoutes(app: Hono, context: ApiContext) {
  app.get('/api/specs/:specId/tasks', (c) => {
    const specId = c.req.param('specId')
    const spec = context.repos.specs.get(specId as never)
    if (spec == null) {
      throw new NotFoundError(`Spec not found: ${specId}`)
    }
    const tasks = context.repos.tasks.list(specId as never)
    const integrityByTaskId = getTaskExecutionIntegrityFieldsMap(context, tasks, new Map([[spec.id, spec]]))
    return c.json(publicOutput(
      tasks.map((task) => ({
        ...task,
        ...integrityByTaskId.get(task.id)!,
      })),
    ))
  })

  app.post('/api/specs/:specId/tasks', async (c) => {
    const specId = c.req.param('specId')
    const spec = context.repos.specs.get(specId as never)
    if (spec == null) {
      throw new NotFoundError(`Spec not found: ${specId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const complexity = optionalComplexity(body.complexity, 'complexity') ?? null
    const targetId = optionalString(body.targetId, 'targetId') ?? null
    if (targetId != null) {
      const target = context.repos.targets.get(targetId as never)
      if (target == null) {
        throw new NotFoundError(`Target not found: ${targetId}`)
      }
      if (target.projectId !== spec.projectId) {
        throw new ValidationError('Task target must belong to the same project as the spec')
      }
    }
    const sourceScope = resolveTaskSourceScope(context, spec.projectId as never, body)
    const assignedAgentId = optionalString(body.assignedAgentId, 'assignedAgentId') ?? null
    if (assignedAgentId != null && context.repos.agents.get(assignedAgentId as never) == null) {
      throw new NotFoundError(`Agent not found: ${assignedAgentId}`)
    }
    const created = context.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: specId as never,
      targetId: targetId as never,
      repositoryId: sourceScope.repositoryId,
      componentId: sourceScope.componentId,
      name: requireString(body.name, 'name'),
      prompt: optionalString(body.prompt, 'prompt') ?? '',
      repos: sourceScope.repos,
      assignedAgentId: assignedAgentId as never,
      requiredRole: optionalRequiredRole(body.requiredRole, 'requiredRole') ?? null,
      complexity,
      status: optionalTaskStatus(body.status, 'status') ?? 'pending',
      verification: optionalStringArray(body.verification, 'verification') ?? [],
    })
    await evaluateTaskDAGAndKick(context, specId, 'task create', [created.id])
    return c.json(publicOutput(context.repos.tasks.get(created.id) ?? created), 201)
  })

  app.get('/api/tasks/:id', (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    const spec = context.repos.specs.get(task.specId)
    return c.json(publicOutput({
      ...task,
      ...getTaskExecutionIntegrityFields(context, task, spec),
    }))
  })

  app.delete('/api/tasks/:id', (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    context.repos.tasks.delete(task.id)
    return c.body(null, 204)
  })

  app.put('/api/tasks/:id/agent', async (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const agentId = requireString(body.agentId, 'agentId')
    const agent = context.repos.agents.get(agentId as never)
    if (agent == null) {
      throw new NotFoundError(`Agent not found: ${agentId}`)
    }
    const hasLiveRun = context.repos.runs
      .list(task.id)
      .some((run) => run.terminalState == null && !TERMINAL_STAGES.has(run.stage))
    if (hasLiveRun) {
      throw new ConflictError(`Cannot reassign task ${task.id} while it has an active run`)
    }

    const updated = context.repos.tasks.assignAgent(task.id, agent.id)
    await evaluateTaskDAGAndKick(context, task.specId, 'task assignment', [updated.id])
    return c.json(publicOutput(updated))
  })

  app.get('/api/tasks/:id/dependencies', (c) =>
    c.json(publicOutput(context.repos.taskDependencies.list(c.req.param('id') as never))),
  )

  app.post('/api/tasks/:id/dependencies', async (c) => {
    const taskId = c.req.param('id')
    const task = context.repos.tasks.get(taskId as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${taskId}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const dependsOnId = requireString(body.dependsOnId, 'dependsOnId')
    const dependsOn = context.repos.tasks.get(dependsOnId as never)
    if (dependsOn == null) {
      throw new NotFoundError(`Task not found: ${dependsOnId}`)
    }
    if (task.id === dependsOn.id) {
      throw new ValidationError('Task cannot depend on itself')
    }
    if (task.specId !== dependsOn.specId) {
      throw new ValidationError('Task dependency must stay within the same spec')
    }

    context.repos.taskDependencies.add({ taskId: task.id, dependsOnId: dependsOn.id })
    const validation = context.dag.validateDAG(task.specId)
    if (!validation.valid) {
      context.repos.taskDependencies.remove(task.id, dependsOn.id)
      throw new ValidationError('Task dependency creates a cycle', { cycle: validation.cycle })
    }

    if (task.status === 'ready' && dependsOn.status !== 'done') {
      context.repos.tasks.updateStatus(task.id, 'blocked')
    } else {
      await evaluateTaskDAGAndKick(context, task.specId, 'task dependency add', [task.id])
    }

    return c.json(publicOutput({ taskId, dependsOnId }), 201)
  })

  app.delete('/api/tasks/:id/dependencies/:depId', async (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    context.repos.taskDependencies.remove(task.id, c.req.param('depId') as never)
    await evaluateTaskDAGAndKick(context, task.specId, 'task dependency removal', [task.id])
    return c.body(null, 204)
  })

  app.put('/api/tasks/:id/status', async (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const status = parseTaskStatus(body.status, 'status')

    // Guard: reject resetting to idle states while an active run exists
    if (status === 'ready' || status === 'pending') {
      const hasActiveRun = context.repos.runs
        .list(task.id)
        .some((run) => !TERMINAL_STAGES.has(run.stage))
      if (hasActiveRun) {
        throw new ConflictError(
          `Cannot set task ${task.id} to '${status}' while it has an active run`,
        )
      }
    }
    if (status === 'done') {
      const integrity = getTaskExecutionIntegrityFields(context, { ...task, status: 'done' })
      if (integrity.executionIssues.some((issue) => isPrimaryTaskExecutionIssueCode(issue.code))) {
        throw new ConflictError(
          `Cannot mark task ${task.id} done without Ductum execution lineage or explicit external outcome`,
          { executionIntegrity: integrity },
        )
      }
    }

    const updated = context.repos.tasks.updateStatus(task.id, status)
    await evaluateTaskDAGAndKick(context, task.specId, 'task status change', [updated.id])
    return c.json(publicOutput(updated))
  })

  app.post('/api/tasks/:id/complete', async (c) => {
    const task = context.repos.tasks.get(c.req.param('id') as never)
    if (task == null) {
      throw new NotFoundError(`Task not found: ${c.req.param('id')}`)
    }
    const body = await readJson<Record<string, unknown>>(c)
    const reason = requireString(body.reason, 'reason').trim()
    if (reason === '') {
      throw new ValidationError('reason is required for task complete')
    }

    // Idempotent: if already done, do not append duplicate evidence/decisions.
    if (task.status === 'done') {
      return c.json(publicOutput({
        task: {
          ...task,
          ...getTaskExecutionIntegrityFields(context, task, context.repos.specs.get(task.specId)),
        },
        alreadyDone: true,
        decision: null,
        evidence: null,
      }))
    }

    const hasActiveRun = context.repos.runs
      .list(task.id)
      .some((run) => !TERMINAL_STAGES.has(run.stage) && run.terminalState == null)
    if (hasActiveRun) {
      throw new ConflictError(
        `Cannot complete task ${task.id} while it has an active run; close or reset the run first`,
      )
    }

    const previousStatus = task.status
    const updatedTask = context.repos.tasks.updateStatus(task.id, 'done')
    const spec = context.repos.specs.get(updatedTask.specId)

    const decision = context.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: spec?.id ?? null,
      taskId: updatedTask.id,
      runId: null,
      decision: `operator-complete: ${reason}`,
      context: reason,
      alternatives: null,
      decidedBy: 'operator',
      supersedesId: null,
    })

    // If the task has any prior runs, attach an operator-note evidence row
    // to the most recent one as the auditable anchor. If it has no runs
    // (operator-direct work), the Decision is the durable record.
    const runs = context.repos.runs.list(updatedTask.id)
    const anchorRun = runs.length === 0
      ? null
      : runs.reduce((latest, run) => (latest == null || run.updatedAt > latest.updatedAt ? run : latest), runs[0])
    let evidenceRow = null
    if (anchorRun != null) {
      evidenceRow = context.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: anchorRun.id,
        type: 'custom',
        payload: {
          kind: 'operator-note',
          note: `task-complete: ${reason}`,
          source: 'task-complete',
          fromTaskStatus: previousStatus,
          toTaskStatus: 'done',
        },
      })
    }

    await evaluateTaskDAGAndKick(context, updatedTask.specId, 'task complete')
    return c.json(publicOutput({
      task: {
        ...updatedTask,
        ...getTaskExecutionIntegrityFields(context, updatedTask, spec),
      },
      alreadyDone: false,
      decision,
      evidence: evidenceRow,
    }))
  })

  app.post('/api/tasks/evaluate-dag', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const specId = requireString(body.specId, 'specId')
    if (context.repos.specs.get(specId as never) == null) {
      throw new NotFoundError(`Spec not found: ${specId}`)
    }
    const readyTaskIds = await evaluateTaskDAGAndKick(context, specId, 'task DAG evaluation')
    return c.json(publicOutput({ readyTaskIds }))
  })
}
