import { log, type RunId } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordReconcileSideEffectFailure } from './reconcile-audit.js'
import type { ReconcileSideEffectAuditFailureEntry, ReconcileSideEffectFailureEntry } from './reconcile-types.js'

export interface CompletionSideEffectsResult {
  failures: ReconcileSideEffectFailureEntry[]
  auditFailures: ReconcileSideEffectAuditFailureEntry[]
}

export function runReconcileSideEffect(
  context: ApiContext,
  runId: RunId,
  operation: string,
  fn: () => void,
): ReconcileSideEffectFailureEntry | ReconcileSideEffectAuditFailureEntry | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(
      'reconcile',
      `${operation} failed for ${runId.slice(0, 8)}: ${message}`,
    )
    let audit: ReconcileSideEffectFailureEntry['audit']
    try {
      audit = context.db.transaction(() => recordReconcileSideEffectFailure(context, { runId, operation, error }))()
    } catch (auditError) {
      const auditMessage = auditError instanceof Error ? auditError.message : String(auditError)
      return { runId, operation, error: message, auditError: auditMessage }
    }
    return { runId, operation, error: message, audit }
  }
}

export function runCompletionSideEffects(context: ApiContext, runIds: RunId[]): CompletionSideEffectsResult {
  const failures: ReconcileSideEffectFailureEntry[] = []
  const auditFailures: ReconcileSideEffectAuditFailureEntry[] = []
  for (const runId of runIds) {
    recordSideEffectResult(failures, auditFailures, () => (
      runReconcileSideEffect(context, runId, 'dag.onRunComplete', () => context.dag.onRunComplete(runId))
    ))
    recordSideEffectResult(failures, auditFailures, () => (
      runReconcileSideEffect(context, runId, 'enforcement.disposeRuntime', () => context.enforcement.disposeRuntime(runId))
    ))
  }
  return { failures, auditFailures }
}

function recordSideEffectResult(
  failures: ReconcileSideEffectFailureEntry[],
  auditFailures: ReconcileSideEffectAuditFailureEntry[],
  fn: () => ReconcileSideEffectFailureEntry | ReconcileSideEffectAuditFailureEntry | undefined,
): void {
  const failure = fn()
  if (failure == null) return
  if ('audit' in failure) failures.push(failure)
  else auditFailures.push(failure)
}
