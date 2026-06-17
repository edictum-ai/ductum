import type { EvidenceId, Run, Task } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { addEvidence } from './run-ops.js'

export type ReconcileAuditReason =
  | 'merged'
  | 'orphaned'
  | 'stale_approval'
  | 'approval_lineage'
  | 'task_failed'
  | 'side_effect_failure'

export interface ReconcileAuditRecord {
  updateId: number
  evidenceId: EvidenceId
}

export function recordReconcileAudit(
  context: ApiContext,
  input: {
    run: Run
    afterRun?: Run
    reason: ReconcileAuditReason
    message: string
    details?: Record<string, unknown>
  },
): ReconcileAuditRecord {
  const update = context.repos.runUpdates.create(input.run.id, `reconcile ${input.reason}: ${input.message}`)
  const afterRun = input.afterRun ?? requireCurrentRun(context, input.run.id)
  const evidence = addEvidence(context, input.run.id, 'custom', {
    ...(input.details ?? {}),
    kind: 'state-reconcile',
    reason: input.reason,
    message: input.message,
    before: summarizeRun(input.run),
    after: summarizeRun(afterRun),
  })
  return { updateId: update.id, evidenceId: evidence.id }
}

export function recordTaskReconcileAudit(
  context: ApiContext,
  input: {
    task: Task
    anchorRun: Run
    reason: string
    runIds: string[]
  },
): ReconcileAuditRecord {
  const currentRun = context.repos.runs.get(input.anchorRun.id) ?? input.anchorRun
  return recordReconcileAudit(context, {
    run: input.anchorRun,
    afterRun: currentRun,
    reason: 'task_failed',
    message: `marked task ${input.task.id.slice(0, 8)} failed`,
    details: {
      taskId: input.task.id,
      taskName: input.task.name,
      taskStatus: { before: 'active', after: 'failed' },
      taskReason: input.reason,
      runIds: input.runIds,
    },
  })
}

export function recordReconcileSideEffectFailure(
  context: ApiContext,
  input: { runId: Run['id']; operation: string; error: unknown },
): ReconcileAuditRecord {
  const run = requireCurrentRun(context, input.runId)
  const error = input.error instanceof Error ? input.error.message : String(input.error)
  return recordReconcileAudit(context, {
    run,
    reason: 'side_effect_failure',
    message: `${input.operation} failed after reconcile commit: ${error}`,
    details: {
      operation: input.operation,
      error,
    },
  })
}

function requireCurrentRun(context: ApiContext, runId: Run['id']): Run {
  const run = context.repos.runs.get(runId)
  if (run == null) {
    throw new Error(`Cannot record reconcile audit for missing run: ${runId}`)
  }
  return run
}

function summarizeRun(run: Run): Record<string, unknown> {
  return {
    runId: run.id,
    taskId: run.taskId,
    stage: run.stage,
    terminalState: run.terminalState,
    pendingApproval: run.pendingApproval,
    blockedReason: run.blockedReason,
    failReason: run.failReason,
    recoverable: run.recoverable,
  }
}
