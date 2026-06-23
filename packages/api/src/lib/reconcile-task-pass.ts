import { log, type SpecId, type Task } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordTaskReconcileAudit, type ReconcileAuditRecord } from './reconcile-audit.js'
import { collectTasksByStatus } from './reconcile-scan.js'
import { repairClosedLineageTask, repairStaleFailedLineageTask } from './reconcile-task-status.js'
import type { TaskReconcileEntry } from './reconcile-types.js'

export interface ReconcileTaskPassResult {
  scannedTasks: number
  tasksReconciled: TaskReconcileEntry[]
}

export function reconcileTaskStatuses(context: ApiContext, dryRun: boolean): ReconcileTaskPassResult {
  const result: ReconcileTaskPassResult = { scannedTasks: 0, tasksReconciled: [] }
  const activeTasks = collectTasksByStatus(context, 'active')
  const failedTasks = collectTasksByStatus(context, 'failed')
  result.scannedTasks = activeTasks.length + failedTasks.length

  for (const task of activeTasks) {
    const runs = context.repos.runs.list(task.id)
    const lineageRepair = repairClosedLineageTask(context, task, runs, dryRun)
    if (lineageRepair != null) {
      appendTaskRepair(result, lineageRepair, context, task.specId, dryRun)
      continue
    }
    const failedRepair = repairActiveTaskFailure(context, task, runs, dryRun)
    if (failedRepair != null) appendTaskRepair(result, failedRepair, context, task.specId, dryRun)
  }

  for (const task of failedTasks) {
    const repair = repairStaleFailedLineageTask(context, task, context.repos.tasks.list(task.specId), dryRun)
    if (repair != null) appendTaskRepair(result, repair, context, task.specId, dryRun)
  }

  return result
}

function repairActiveTaskFailure(
  context: ApiContext,
  task: Task,
  runs: ReturnType<ApiContext['repos']['runs']['list']>,
  dryRun: boolean,
): TaskReconcileEntry | null {
  if (runs.length === 0) return null
  if (runs.some((run) => run.terminalState == null && run.stage !== 'done')) return null
  if (runs.some((run) => run.terminalState === 'quarantined')) return null
  if (runs.some((run) => run.stage === 'done')) return null

  const lastFail = [...runs].reverse().find((run) => run.failReason != null && run.failReason !== '')
  const auditRun = lastFail ?? runs.at(-1)!
  const taskReason = auditRun.failReason == null || auditRun.failReason === '' ? 'all runs terminal' : auditRun.failReason

  log.info(
    'reconcile',
    `task ${task.id.slice(0, 8)} (${task.name}) has no live runs and ${runs.length} terminal failure(s) — marking failed`,
  )

  let audit: ReconcileAuditRecord | undefined
  if (!dryRun) {
    audit = context.db.transaction(() => {
      context.repos.tasks.updateStatus(task.id, 'failed')
      return recordTaskReconcileAudit(context, {
        task,
        anchorRun: auditRun,
        reason: taskReason,
        runIds: runs.map((run) => run.id),
      })
    })()
  }

  return {
    taskId: task.id,
    taskName: task.name,
    fromStatus: task.status,
    toStatus: 'failed',
    reason: taskReason,
    auditRunId: auditRun.id,
    ...(audit == null ? {} : { audit }),
  }
}

function appendTaskRepair(
  result: ReconcileTaskPassResult,
  entry: TaskReconcileEntry,
  context: ApiContext,
  specId: SpecId,
  dryRun: boolean,
): void {
  result.tasksReconciled.push(entry)
  if (!dryRun) context.dag.evaluateTaskDAG(specId)
}
