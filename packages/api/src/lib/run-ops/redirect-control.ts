import type { AgentId, RunId, TaskId, TaskStatus } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'
import { requireLatestTaskRun, requireRun } from '../operator-run-guards.js'
import { addEvidence } from './evidence.js'

export interface RedirectRunInput {
  runId: RunId
  agentId: AgentId
  reason: string
  decidedBy?: string
}

export interface RedirectRunResult {
  ok: true
  runId: RunId
  taskId: TaskId
  taskStatus: TaskStatus
  fromAgentId: AgentId
  toAgentId: AgentId
  toAgentName: string
  failReason: string | null
}

export async function redirectRun(context: ApiContext, input: RedirectRunInput): Promise<RedirectRunResult> {
  const reason = requireReason(input.reason)
  const run = requireRun(context, input.runId)
  requireLatestTaskRun(context, run, 'redirect')
  if (run.terminalState != null) throw new ConflictError(`Run ${run.id} is already ${run.terminalState}`)
  if (run.stage === 'done') throw new ConflictError(`Run ${run.id} is already done`)

  const task = context.repos.tasks.get(run.taskId)
  if (task == null) throw new ValidationError(`Task not found: ${run.taskId}`)
  if (task.status !== 'active') {
    throw new ConflictError(`Run ${run.id} cannot be redirected because task ${task.id} is ${task.status}`)
  }

  const agent = context.repos.agents.get(input.agentId)
  if (agent == null) throw new NotFoundError(`Agent not found: ${input.agentId}`)
  if (agent.id === run.agentId) {
    throw new ValidationError(`Run ${run.id} is already assigned to agent ${agent.name}`)
  }

  await context.killRun?.(run.id, 'cancelled')
  const result = context.db.transaction(() => {
    const cancelled = context.stateMachine.markCancelled(
      run.id,
      `redirected to ${agent.name}: ${reason}`,
    )
    context.repos.tasks.assignAgent(task.id, agent.id)
    context.repos.tasks.updateRetry(task.id, 0, null)
    const updatedTask = context.repos.tasks.updateStatus(task.id, 'ready')
    context.dag.evaluateTaskDAG(task.specId)
    addEvidence(context, run.id, 'custom', {
      kind: 'operator-note',
      note: `Attempt redirected to ${agent.name}. ${reason}`,
      operation: 'run.redirect',
      decided_by: input.decidedBy ?? 'operator',
      reason,
      from_agent_id: run.agentId,
      to_agent_id: agent.id,
      to_agent_name: agent.name,
    })
    context.repos.runUpdates.create(
      run.id,
      `operator redirected run to ${agent.name}; task returned to ready queue: ${reason}`,
    )
    return { cancelled, updatedTask }
  })()

  context.enforcement.disposeRuntime(run.id)
  return {
    ok: true,
    runId: run.id,
    taskId: result.updatedTask.id,
    taskStatus: result.updatedTask.status,
    fromAgentId: run.agentId,
    toAgentId: agent.id,
    toAgentName: agent.name,
    failReason: result.cancelled.failReason,
  }
}

function requireReason(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ValidationError('redirect: reason is required')
  return trimmed
}
