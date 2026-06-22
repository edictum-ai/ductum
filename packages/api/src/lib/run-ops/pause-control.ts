import type { RunId, TaskStatus } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ConflictError, ValidationError } from '../errors.js'
import { requireLatestTaskRun, requireRun } from '../operator-run-guards.js'
import { addEvidence } from './evidence.js'

export interface PauseRunInput {
  runId: RunId
  reason: string
  decidedBy?: string
}

export interface ResumeRunInput {
  runId: RunId
  reason: string
  decidedBy?: string
}

export interface ResumeRunResult {
  ok: true
  runId: RunId
  taskId: string
  taskStatus: TaskStatus
  failReason: string | null
}

export async function pauseRun(context: ApiContext, input: PauseRunInput) {
  const reason = requireReason(input.reason, 'pause')
  const run = requireRun(context, input.runId)
  requireLatestTaskRun(context, run, 'pause')
  if (run.terminalState != null) throw new ConflictError(`Run ${run.id} is already ${run.terminalState}`)
  if (run.stage === 'done') throw new ConflictError(`Run ${run.id} is already done`)

  await context.killRun?.(run.id, 'killed')
  const paused = context.db.transaction(() => {
    const updated = context.stateMachine.markPaused(run.id, reason)
    addEvidence(context, run.id, 'custom', {
      kind: 'operator-note',
      note: `Attempt paused. ${reason}`,
      operation: 'run.pause',
      decided_by: input.decidedBy ?? 'operator',
      reason,
    })
    context.repos.runUpdates.create(run.id, `operator paused run: ${reason}`)
    return updated
  })()

  context.enforcement.disposeRuntime(run.id)
  return paused
}

export function resumePausedRun(context: ApiContext, input: ResumeRunInput): ResumeRunResult {
  const reason = requireReason(input.reason, 'resume')
  const run = requireRun(context, input.runId)
  requireLatestTaskRun(context, run, 'resume')
  if (run.terminalState !== 'paused') {
    throw new ValidationError(
      `Run ${run.id} is not paused (terminalState: ${run.terminalState ?? 'null'})`,
    )
  }
  const task = context.repos.tasks.get(run.taskId)
  if (task == null) throw new ValidationError(`Task not found: ${run.taskId}`)
  if (task.status !== 'active') {
    throw new ConflictError(
      `Run ${run.id} is no longer resumable because task ${task.id} is ${task.status}`,
    )
  }

  context.repos.tasks.updateRetry(task.id, 0, null)
  const updatedTask = context.repos.tasks.updateStatus(task.id, 'ready')
  context.dag.evaluateTaskDAG(task.specId)
  addEvidence(context, run.id, 'custom', {
    kind: 'operator-note',
    note: `Paused attempt resumed. ${reason}`,
    operation: 'run.resume',
    decided_by: input.decidedBy ?? 'operator',
    reason,
  })
  context.repos.runUpdates.create(run.id, `operator resumed paused run; task back in ready queue: ${reason}`)

  return {
    ok: true,
    runId: run.id,
    taskId: updatedTask.id,
    taskStatus: updatedTask.status,
    failReason: run.failReason,
  }
}

function requireReason(value: string, action: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new ValidationError(`${action}: reason is required`)
  return trimmed
}
