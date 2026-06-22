import type { DAGEvaluator } from './dag.js'
import { log } from './logger.js'
import { canResumeStalledRun } from './dispatcher-resume.js'
import { classifyRetryExhaustion } from './quarantine-classifier.js'
import type { DuctumEventEmitter } from './events.js'
import type { RunCheckpointRepo, RunRepo, TaskRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { RunId } from './types.js'

export interface RetryOrFailStalledTaskDeps {
  runRepo: RunRepo
  taskRepo: TaskRepo
  dag: DAGEvaluator
  eventEmitter: DuctumEventEmitter
  runCheckpointRepo?: RunCheckpointRepo
  /** Owns the quarantined terminal transition (C4: Ductum owns resets/quarantine). */
  stateMachine: RunStateMachine
  maxTaskRetries: number
  retryBackoffScheduleMs: readonly number[]
  canSeedWorkflowStage: boolean
  now: () => Date
}

export interface RetryOrFailExtra {
  /** The real failure reason for this attempt (crash path). Persisted to the
   *  run AND used for deterministic-vs-transient classification. The caller
   *  threads the harness result.failReason here so recurrence is readable. */
  failReason?: string
  /** Force transient regardless of reason. Provider-backoff / failover
   *  exhaustion (waitAndResume) is transient by construction and must never
   *  quarantine (design/04 §5 — keep provider/transient out of quarantine). */
  forceTransient?: boolean
}

export function retryOrFailStalledTask(
  deps: RetryOrFailStalledTaskDeps,
  runId: RunId,
  cause: 'crash' | 'heartbeat',
  backoffMsOverride?: number,
  extra?: RetryOrFailExtra,
): boolean {
  const run = deps.runRepo.get(runId)
  if (run == null) return false
  const failReason = extra?.failReason ?? run.failReason ?? 'stalled'
  // Persist the real failure reason (crash path) so recurrence is durable.
  deps.runRepo.updateFailure(run.id, failReason, true)

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
    // Retry budget exhausted: quarantine a DETERMINISTIC poison failure, or
    // mark the task failed for a transient/provider/ambiguous one.
    const priorFailReasons = deps.runRepo
      .list(run.taskId)
      .filter((candidate) => candidate.id !== run.id)
      .map((candidate) => candidate.failReason)
    const failureClass = classifyRetryExhaustion({
      cause,
      failReason,
      priorFailReasons,
      forceTransient: extra?.forceTransient,
    })
    if (failureClass === 'deterministic') {
      // Quarantine the RUN and LEAVE the task 'active' — the existing
      // "run died, needs operator" convention (parallel to the failed-run
      // path that also leaves the task active). A poison task thus surfaces
      // in the needs-operator inbox instead of silently re-looping, and it is
      // never redispatched: getReady selects only status='ready'. design/04 §5.
      deps.stateMachine.markQuarantined(run.id, failReason)
      deps.dag.evaluateTaskDAG(task.specId)
      log.warn('dispatcher', `task ${task.name} (${task.id}) quarantined — deterministic failure exhausted retry budget (${deps.maxTaskRetries})`)
    } else {
      deps.taskRepo.updateStatus(task.id, 'failed')
      deps.dag.evaluateTaskDAG(task.specId)
      deps.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'failed' })
      log.info('dispatcher', `task ${task.name} (${task.id}) exceeded max retries (${deps.maxTaskRetries}), marked failed`)
    }
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
