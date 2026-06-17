import type { RunId, TaskId } from '@ductum/core'

import type { ReconcileAuditRecord } from './reconcile-audit.js'

export interface ReconcileOptions {
  base?: string
  cwd?: string
  dryRun?: boolean
  orphanThresholdSeconds?: number
  maxPasses?: number
}

export interface RunReconcileEntry {
  runId: RunId
  reason: 'merged' | 'orphaned' | 'stale_approval' | 'approval_lineage'
  resolution?: 'cleared' | 'restored'
  mergeCommit?: string
  ancestorsMarkedDone?: RunId[]
  ancestorAudits?: Array<{ runId: RunId; audit: ReconcileAuditRecord }>
  staleSeconds?: number
  audit?: ReconcileAuditRecord
}

export interface TaskReconcileEntry {
  taskId: TaskId
  taskName: string
  fromStatus: 'active'
  toStatus: 'failed'
  reason: string
  auditRunId?: RunId
  audit?: ReconcileAuditRecord
}

export interface ReconcileSideEffectFailureEntry {
  runId: RunId
  operation: string
  error: string
  audit: ReconcileAuditRecord
}

export interface ReconcileSideEffectAuditFailureEntry {
  runId: RunId
  operation: string
  error: string
  auditError: string
}

export interface ReconcileResult {
  scannedRuns: number
  scannedTasks: number
  passes: number
  maxPasses: number
  converged: boolean
  runsReconciled: RunReconcileEntry[]
  tasksReconciled: TaskReconcileEntry[]
  sideEffectFailures: ReconcileSideEffectFailureEntry[]
  sideEffectAuditFailures: ReconcileSideEffectAuditFailureEntry[]
  dryRun: boolean
}
