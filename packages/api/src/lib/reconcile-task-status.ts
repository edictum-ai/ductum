import { classifyTask, type Run, type Task } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordTaskStatusReconcileAudit } from './reconcile-audit.js'
import type { TaskReconcileEntry } from './reconcile-types.js'

export function repairClosedLineageTask(
  context: ApiContext,
  task: Task,
  runs: Run[],
  dryRun: boolean,
): TaskReconcileEntry | null {
  const parsed = classifyTask(task)
  if (parsed.kind !== 'fix' && parsed.kind !== 'review') return null
  if (runs.some((run) => run.terminalState == null && run.stage !== 'done')) return null

  if (runs.length === 0) {
    const reason = 'active lineage task has no attempt'
    if (!dryRun) context.repos.tasks.updateStatus(task.id, 'ready')
    return {
      taskId: task.id,
      taskName: task.name,
      fromStatus: 'active',
      toStatus: 'ready',
      reason,
    }
  }

  const latestDone = [...runs].reverse().find((run) => run.stage === 'done')
  if (latestDone == null) return null
  const reason = 'lineage task attempt completed'
  const audit = dryRun ? undefined : context.db.transaction(() => {
    context.repos.tasks.updateStatus(task.id, 'done')
    return recordTaskStatusReconcileAudit(context, {
      task,
      anchorRun: latestDone,
      reason: 'task_done',
      status: 'done',
      message: reason,
      runIds: runs.map((run) => run.id),
    })
  })()
  return {
    taskId: task.id,
    taskName: task.name,
    fromStatus: 'active',
    toStatus: 'done',
    reason,
    auditRunId: latestDone.id,
    ...(audit == null ? {} : { audit }),
  }
}
