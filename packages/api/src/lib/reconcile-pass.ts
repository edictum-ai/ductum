import { log, type RunId } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordReconcileAudit, type ReconcileAuditRecord } from './reconcile-audit.js'
import { collectOpenAncestorRuns, collectOpenDescendantIdsByRun } from './reconcile-lineage.js'
import { resolveOrphanedRun } from './reconcile-orphans.js'
import { collectAllRuns, findMergeCommitForRun } from './reconcile-scan.js'
import { runCompletionSideEffects } from './reconcile-side-effects.js'
import { isRecoverableStaleSlotApproval, restoreStaleSlotApproval } from './reconcile-stale-approval.js'
import { reconcileTaskStatuses } from './reconcile-task-pass.js'
import type {
  ReconcileOptions,
  ReconcileResult,
  ReconcileSideEffectAuditFailureEntry,
  ReconcileSideEffectFailureEntry,
  RunReconcileEntry,
  TaskReconcileEntry,
} from './reconcile-types.js'

export interface ReconcilePassResult {
  scannedRuns: number
  scannedTasks: number
  runsReconciled: RunReconcileEntry[]
  tasksReconciled: TaskReconcileEntry[]
  sideEffectFailures: ReconcileSideEffectFailureEntry[]
  sideEffectAuditFailures: ReconcileSideEffectAuditFailureEntry[]
}

// Recovery for older zombie DB shapes; not general success inference.
export async function reconcileSinglePass(
  context: ApiContext,
  options: Required<Pick<ReconcileOptions, 'base' | 'cwd' | 'dryRun' | 'orphanThresholdSeconds'>>,
): Promise<ReconcilePassResult> {
  const now = context.now()
  const result: ReconcilePassResult = {
    scannedRuns: 0,
    scannedTasks: 0,
    runsReconciled: [],
    tasksReconciled: [],
    sideEffectFailures: [],
    sideEffectAuditFailures: [],
  }

  const allRuns = collectAllRuns(context)
  result.scannedRuns = allRuns.length
  const reconciledRunIds = new Set<RunId>()
  const openDescendantIdsByRun = collectOpenDescendantIdsByRun(allRuns)
  const runById = new Map(allRuns.map((run) => [run.id, run]))

  for (const run of allRuns) {
    if (!run.pendingApproval) continue
    if (run.stage !== 'done' && run.terminalState == null) continue

    if (isRecoverableStaleSlotApproval(run)) {
      reconciledRunIds.add(run.id)
      result.runsReconciled.push(restoreStaleSlotApproval(context, run, options.dryRun))
      continue
    }

    if (run.stage !== 'done') continue

    log.info(
      'reconcile',
      `run ${run.id.slice(0, 8)} is ${run.stage}/${run.terminalState ?? 'non-terminal'} with stale pending approval — clearing approval latch`,
    )

    let audit: ReconcileAuditRecord | undefined
    if (!options.dryRun) {
      audit = context.db.transaction(() => {
        context.repos.runs.updateWorkflowState(run.id, {
          blockedReason: null,
          pendingApproval: false,
        })
        return recordReconcileAudit(context, {
          run,
          reason: 'stale_approval',
          message: 'cleared stale approval latch',
        })
      })()
    }

    result.runsReconciled.push({
      runId: run.id,
      reason: 'stale_approval',
      resolution: 'cleared',
      ...(audit == null ? {} : { audit }),
    })
  }

  for (const run of allRuns) {
    if (run.stage === 'done') continue
    if (run.terminalState != null) continue
    if (run.branch == null || run.branch === '') continue
    if (hasOpenDescendantOnBranch(openDescendantIdsByRun, runById, run.id, run.branch)) continue
    if (!hasRecordedCommit(run) && !isBranchOnlyMergeRecoveryEligible(run)) continue

    const mergeSha = await findMergeCommitForRun(options.cwd, options.base, run.id, run.branch, run.commitSha)
    if (mergeSha == null) continue

    log.info(
      'reconcile',
      `run ${run.id.slice(0, 8)} on branch ${run.branch} already merged at ${mergeSha.slice(0, 8)} — marking done`,
    )

    const ancestorRuns = collectOpenAncestorRuns(context, run)
    const ancestors = ancestorRuns.map((parent) => parent.id)
    const ancestorAudits: Array<{ runId: RunId; audit: ReconcileAuditRecord }> = []
    let audit: ReconcileAuditRecord | undefined
    if (!options.dryRun) {
      audit = context.db.transaction(() => {
        context.stateMachine.markDone(run.id, `reconciled — found merge commit ${mergeSha.slice(0, 8)}`)
        for (const parent of ancestorRuns) {
          context.stateMachine.markDone(parent.id, `reconciled — descendant ${run.id.slice(0, 8)} found merged`)
          ancestorAudits.push({
            runId: parent.id,
            audit: recordReconcileAudit(context, {
              run: parent,
              reason: 'merged',
              message: `marked ancestor done after merged descendant ${run.id.slice(0, 8)}`,
              details: { descendantRunId: run.id, mergeCommit: mergeSha },
            }),
          })
        }
        return recordReconcileAudit(context, {
          run,
          reason: 'merged',
          message: `marked done from merge commit ${mergeSha.slice(0, 8)}`,
          details: { mergeCommit: mergeSha },
        })
      })()
      appendSideEffects(result, runCompletionSideEffects(context, [run.id, ...ancestors]))
    }

    reconciledRunIds.add(run.id)
    result.runsReconciled.push({
      runId: run.id,
      reason: 'merged',
      disposition: 'completed-but-unrecorded',
      mergeCommit: mergeSha,
      ancestorsMarkedDone: ancestors,
      ...(ancestorAudits.length === 0 ? {} : { ancestorAudits }),
      ...(audit == null ? {} : { audit }),
    })
  }

  for (const root of allRuns) {
    if (!root.pendingApproval) continue
    if (root.stage !== 'ship' || root.terminalState != null) continue
    const openDescendants = openDescendantIdsByRun.get(root.id) ?? new Set<RunId>()
    for (const descendantId of openDescendants) {
      if (reconciledRunIds.has(descendantId)) continue
      const descendant = runById.get(descendantId)
      if (descendant == null) continue
      log.info(
        'reconcile',
        `run ${descendant.id.slice(0, 8)} is an open descendant of approval-ready root ${root.id.slice(0, 8)} — marking done`,
      )
      let audit: ReconcileAuditRecord | undefined
      if (!options.dryRun) {
        const task = context.repos.tasks.get(descendant.taskId)
        audit = context.db.transaction(() => {
          context.stateMachine.markDone(descendant.id, `reconciled — root ${root.id.slice(0, 8)} is awaiting approval`)
          return recordReconcileAudit(context, {
            run: descendant,
            reason: 'approval_lineage',
            message: `marked done because root ${root.id.slice(0, 8)} is awaiting approval`,
            details: {
              rootRunId: root.id,
              ...(task == null ? {} : {
                taskId: task.id,
                taskName: task.name,
                taskStatus: { before: task.status, after: task.status },
              }),
            },
          })
        })()
      }
      reconciledRunIds.add(descendant.id)
      result.runsReconciled.push({
        runId: descendant.id,
        reason: 'approval_lineage',
        ...(audit == null ? {} : { audit }),
      })
    }
  }

  for (const run of allRuns) {
    if (reconciledRunIds.has(run.id)) continue
    if (run.stage === 'done') continue
    if (run.terminalState != null) continue
    if (run.pendingApproval) continue
    if ((openDescendantIdsByRun.get(run.id)?.size ?? 0) > 0) continue

    const orphaned = resolveOrphanedRun(context, run, now, options.orphanThresholdSeconds)
    if (orphaned == null) continue

    log.info(
      'reconcile',
      `run ${run.id.slice(0, 8)} heartbeat is ${orphaned.staleSeconds}s old (>${orphaned.timeoutSeconds}s) ${orphaned.logSuffix} — marking failed (orphaned)`,
    )

    let audit: ReconcileAuditRecord | undefined
    if (!options.dryRun) {
      audit = context.db.transaction(() => {
        context.repos.runs.updateFailure(
          run.id,
          `reconciled — orphaned (heartbeat ${orphaned.staleSeconds}s old, ${orphaned.failureSuffix})`,
          false,
        )
        if (orphaned.disposition === 'dead-claim') context.repos.attemptLeases.expireRun(run.id, now)
        context.stateMachine.markFailed(run.id, `orphaned by reconcile (${orphaned.failureSuffix})`)
        return recordReconcileAudit(context, {
          run,
          reason: 'orphaned',
          message: `marked failed after stale heartbeat (${orphaned.staleSeconds}s)`,
          details: {
            staleSeconds: orphaned.staleSeconds,
            heartbeatTimeoutSeconds: orphaned.timeoutSeconds,
            livenessSource: orphaned.livenessSource,
            ...(orphaned.livenessSource === 'fallback'
              ? { orphanThresholdSeconds: orphaned.timeoutSeconds }
              : {}),
          },
        })
      })()
    }

    result.runsReconciled.push({
      runId: run.id,
      reason: 'orphaned',
      disposition: orphaned.disposition,
      staleSeconds: orphaned.staleSeconds,
      ...(audit == null ? {} : { audit }),
    })
  }

  const taskPass = reconcileTaskStatuses(context, options.dryRun)
  result.scannedTasks = taskPass.scannedTasks
  result.tasksReconciled.push(...taskPass.tasksReconciled)

  return result
}

function hasOpenDescendantOnBranch(
  openDescendantIdsByRun: Map<RunId, Set<RunId>>,
  runById: Map<RunId, { branch: string | null; stage: string; terminalState: string | null }>,
  runId: RunId,
  branch: string,
): boolean {
  const descendantIds = openDescendantIdsByRun.get(runId)
  if (descendantIds == null) return false
  for (const descendantId of descendantIds) {
    const descendant = runById.get(descendantId)
    if (descendant == null) continue
    if (descendant.stage === 'done' || descendant.terminalState != null) continue
    if (descendant.branch === branch) return true
  }
  return false
}

function hasRecordedCommit(run: { commitSha: string | null }): boolean {
  const commitSha = run.commitSha?.trim()
  return commitSha != null && commitSha !== ''
}

function isBranchOnlyMergeRecoveryEligible(run: { stage: string }): boolean {
  return run.stage === 'ship'
}

function appendSideEffects(result: ReconcilePassResult, sideEffects: ReturnType<typeof runCompletionSideEffects>): void {
  result.sideEffectFailures.push(...sideEffects.failures)
  result.sideEffectAuditFailures.push(...sideEffects.auditFailures)
}
