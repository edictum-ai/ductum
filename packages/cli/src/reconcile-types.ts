export interface ReconcileResult {
  scannedRuns: number
  scannedTasks: number
  passes: number
  maxPasses: number
  converged: boolean
  runsReconciled: Array<{
    runId: string
    reason: 'merged' | 'orphaned' | 'stale_approval' | 'approval_lineage'
    resolution?: 'cleared' | 'restored'
    mergeCommit?: string
    ancestorsMarkedDone?: string[]
    ancestorAudits?: Array<{ runId: string; audit: ReconcileAuditRecord }>
    staleSeconds?: number
    audit?: ReconcileAuditRecord
  }>
  tasksReconciled: Array<{
    taskId: string
    taskName: string
    fromStatus: 'active'
    toStatus: 'failed'
    reason: string
    auditRunId?: string
    audit?: ReconcileAuditRecord
  }>
  sideEffectFailures: Array<{
    runId: string
    operation: string
    error: string
    audit: ReconcileAuditRecord
  }>
  sideEffectAuditFailures: Array<{
    runId: string
    operation: string
    error: string
    auditError: string
  }>
  dryRun: boolean
}

interface ReconcileAuditRecord {
  updateId: number
  evidenceId: string
}
