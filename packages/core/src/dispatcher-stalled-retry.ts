import type { DAGEvaluator } from './dag.js'
import { log } from './logger.js'
import { canResumeStalledRun } from './dispatcher-resume.js'
import type { DuctumEventEmitter } from './events.js'
import type { RunCheckpointRepo, RunRepo, TaskRepo } from './repos/interfaces.js'
import type { RunId } from './types.js'

export interface RetryOrFailStalledTaskDeps {
  runRepo: RunRepo
  taskRepo: TaskRepo
  dag: DAGEvaluator
  eventEmitter: DuctumEventEmitter
  runCheckpointRepo?: RunCheckpointRepo
  maxTaskRetries: number
  retryBackoffScheduleMs: readonly number[]
  canSeedWorkflowStage: boolean
  now: () => Date
}

export function retryOrFailStalledTask(
  deps: RetryOrFailStalledTaskDeps,
  runId: RunId,
  cause: 'crash' | 'heartbeat',
  backoffMsOverride?: number,
): boolean {
  const run = deps.runRepo.get(runId)
  if (run == null) return false
  deps.runRepo.updateFailure(run.id, run.failReason ?? 'stalled', true)

  const task = deps.taskRepo.get(run.taskId)
  if (task == null) return false

  if (cause === 'heartbeat') {
    deps.taskRepo.updateStatus(task.id, 'failed')
    deps.dag.evaluateTaskDAG(task.specId)
    deps.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'failed' })
    log.warn('dispatcher', `task ${task.name} (${task.id}) heartbeat-stalled — no auto-retry (P3 policy), marked failed`)
    return false
  }

  const nextRetryCount = task.retryCount + 1
  if (nextRetryCount > deps.maxTaskRetries) {
    deps.taskRepo.updateRetry(task.id, nextRetryCount, null)
    deps.taskRepo.updateStatus(task.id, 'failed')
    deps.dag.evaluateTaskDAG(task.specId)
    deps.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'failed' })
    log.info('dispatcher', `task ${task.name} (${task.id}) exceeded max retries (${deps.maxTaskRetries}), marked failed`)
    return false
  }

  const backoffMs = backoffMsOverride
    ?? deps.retryBackoffScheduleMs[nextRetryCount - 1]
    ?? deps.retryBackoffScheduleMs[deps.retryBackoffScheduleMs.length - 1]
    ?? 60_000
  const retryAfter = new Date(deps.now().getTime() + backoffMs).toISOString()

  deps.taskRepo.updateRetry(task.id, nextRetryCount, retryAfter)
  deps.taskRepo.updateStatus(task.id, 'ready')
  deps.dag.evaluateTaskDAG(task.specId)
  deps.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'ready' })
  const resuming = canResumeStalledRun(
    deps.runCheckpointRepo,
    run,
    deps.canSeedWorkflowStage,
  )
  log.info(
    'dispatcher',
    `task ${task.name} (${task.id}) crash-retry ${nextRetryCount}/${deps.maxTaskRetries}` +
    `${resuming ? ' (resume from checkpoint)' : ''}, next attempt after ${retryAfter} (backoff ${backoffMs}ms)`,
  )
  return resuming
}
