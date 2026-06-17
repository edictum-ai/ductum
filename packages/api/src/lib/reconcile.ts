import type { ApiContext } from './deps.js'
import { reconcileSinglePass } from './reconcile-pass.js'
import type { ReconcileOptions, ReconcileResult } from './reconcile-types.js'

const DEFAULT_ORPHAN_THRESHOLD_SECONDS = 3600
const DEFAULT_MAX_PASSES = 8

export async function reconcileInconsistentRuns(
  context: ApiContext,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const base = options.base ?? 'main'
  const cwd = options.cwd ?? process.cwd()
  const dryRun = options.dryRun === true
  const orphanThresholdSeconds = options.orphanThresholdSeconds ?? DEFAULT_ORPHAN_THRESHOLD_SECONDS
  const maxPasses = normalizeMaxPasses(options.maxPasses)
  const passLimit = dryRun ? 1 : maxPasses

  const result: ReconcileResult = {
    scannedRuns: 0,
    scannedTasks: 0,
    passes: 0,
    maxPasses,
    converged: false,
    runsReconciled: [],
    tasksReconciled: [],
    sideEffectFailures: [],
    sideEffectAuditFailures: [],
    dryRun,
  }

  for (let passNumber = 0; passNumber < passLimit; passNumber++) {
    const pass = await reconcileSinglePass(context, {
      base,
      cwd,
      dryRun,
      orphanThresholdSeconds,
    })
    result.passes += 1
    if (passNumber === 0) {
      result.scannedRuns = pass.scannedRuns
      result.scannedTasks = pass.scannedTasks
    }
    result.runsReconciled.push(...pass.runsReconciled)
    result.tasksReconciled.push(...pass.tasksReconciled)
    result.sideEffectFailures.push(...pass.sideEffectFailures)
    result.sideEffectAuditFailures.push(...pass.sideEffectAuditFailures)

    const passChangedState =
      pass.runsReconciled.length > 0 ||
      pass.tasksReconciled.length > 0
    if (!passChangedState) {
      result.converged = true
      break
    }

    if (dryRun) {
      result.converged = false
      break
    }
  }

  return result
}

function normalizeMaxPasses(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null) return DEFAULT_MAX_PASSES
  return Math.max(1, Math.floor(value))
}
