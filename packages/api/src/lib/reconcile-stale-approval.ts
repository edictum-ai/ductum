import {
  STARTUP_NO_MAPPING_REASON,
  STARTUP_RESUME_UNAVAILABLE_REASON,
  log,
  type Run,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordReconcileAudit } from './reconcile-audit.js'
import type { RunReconcileEntry } from './reconcile-types.js'

const STALE_SLOT_GC_REASON = 'stale_slot_gc'
const RECOVERABLE_STALLED_APPROVAL_REASONS = new Set<string>([
  STALE_SLOT_GC_REASON,
  STARTUP_RESUME_UNAVAILABLE_REASON,
  STARTUP_NO_MAPPING_REASON,
])

export function isRecoverableStaleSlotApproval(run: Run): boolean {
  return run.stage === 'ship'
    && run.pendingApproval
    && run.terminalState === 'stalled'
    && run.failReason != null
    && RECOVERABLE_STALLED_APPROVAL_REASONS.has(run.failReason)
    && nonBlank(run.branch)
    && nonBlank(run.commitSha)
}

export function restoreStaleSlotApproval(
  context: ApiContext,
  run: Run,
  dryRun: boolean,
): RunReconcileEntry {
  log.info(
    'reconcile',
    `run ${run.id.slice(0, 8)} is approval-ready but stalled by ${run.failReason ?? 'unknown'} — restoring approval state`,
  )

  const task = context.repos.tasks.get(run.taskId)
  const audit = dryRun
    ? undefined
    : context.db.transaction(() => {
      context.repos.runs.updateTerminalState(run.id, null)
      context.repos.runs.updateFailure(run.id, null, true)
      context.repos.runs.updateWorkflowState(run.id, {
        blockedReason: null,
        pendingApproval: true,
      })
      if (task?.status === 'failed') {
        context.repos.tasks.updateStatus(task.id, 'active')
        context.events.emit({
          type: 'task.status_changed',
          taskId: task.id,
          from: 'failed',
          to: 'active',
        })
      }
      return recordReconcileAudit(context, {
        run,
        reason: 'stale_approval',
        message: `restored approval after ${run.failReason ?? 'unknown restart stall'}`,
        details: {
          resolution: 'restored',
          ...(task == null ? {} : {
            taskId: task.id,
            taskName: task.name,
            taskStatus: {
              before: task.status,
              after: task.status === 'failed' ? 'active' : task.status,
            },
          }),
        },
      })
    })()

  return {
    runId: run.id,
    reason: 'stale_approval',
    resolution: 'restored',
    ...(audit == null ? {} : { audit }),
  }
}

function nonBlank(value: string | null): boolean {
  return value != null && value.trim() !== ''
}
