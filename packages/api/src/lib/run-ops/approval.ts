import {
  STARTUP_DEAD_CLAIM_REASON,
  STARTUP_NO_MAPPING_REASON,
  STARTUP_RESUME_SCHEDULED_REASON,
  STARTUP_RESUME_UNAVAILABLE_REASON,
  STARTUP_STALLED_REASON,
  listOpenDescendantRuns,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { addEvidence } from './evidence.js'
import { mergeApprovedRun } from './merge.js'
import type { MergeResult } from './merge-types.js'
import {
  buildApproveFailureRecovery,
  mergeAuditMessage,
  resetRunAfterMergeFailure,
} from './merge-utils.js'
import { nonBlank, requireRun } from './common.js'

const STALE_SLOT_GC_REASON = 'stale_slot_gc'
const RECOVERABLE_STALLED_APPROVAL_REASONS = new Set<string>([
  STALE_SLOT_GC_REASON,
  STARTUP_DEAD_CLAIM_REASON,
  STARTUP_RESUME_UNAVAILABLE_REASON,
  STARTUP_RESUME_SCHEDULED_REASON,
  STARTUP_STALLED_REASON,
  STARTUP_NO_MAPPING_REASON,
])

export interface ApproveRunResult {
  success: boolean
  stage: string
  commitSha?: string
  branch?: string
  reason?: string
  pushed?: boolean
  nextCommand?: string
  followupCommand?: string
}

export async function approveRun(context: ApiContext, runId: RunId): Promise<ApproveRunResult> {
  let run = requireRun(context, runId)
  if (!run.pendingApproval) {
    throw new ValidationError(run.blockedReason ?? `Run ${runId} does not require approval`)
  }
  if (run.terminalState != null) {
    if (!canRecoverStalledApproval(context, run)) {
      throw new ValidationError(`Run ${runId} is ${run.terminalState}; retry the run before approval`)
    }
  }
  assertNoOpenDescendantRuns(context, runId)
  if (isRecoverableStalledApproval(run)) {
    run = restoreStalledApproval(context, run)
  }
  context.repos.runUpdates.create(runId, 'operator approved run; merging')

  let merge: MergeResult
  try {
    merge = await mergeApprovedRun(context, runId, {
      push: context.merge.push ?? false,
      base: context.merge.base ?? 'main',
      strategy: context.merge.strategy ?? 'merge',
      pushTags: context.merge.pushTags ?? false,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    context.repos.runUpdates.create(runId, `operator approval failed during merge: ${msg}`)
    const resetRun = await resetRunAfterMergeFailure(context, runId, msg)
    return { success: false, stage: resetRun.stage, reason: msg, ...buildApproveFailureRecovery(run, msg) }
  }

  const runAfterMerge = context.repos.runs.get(runId)
  if (runAfterMerge != null && runAfterMerge.stage !== 'done') {
    await context.enforcement.recordApproval(runId).catch(() => undefined)
  }
  context.repos.runUpdates.create(runId, mergeAuditMessage(merge))

  return {
    success: true,
    stage: 'done',
    commitSha: merge.commitSha,
    branch: merge.branch,
    pushed: merge.pushed,
  }
}

function canRecoverStalledApproval(context: ApiContext, run: Run): boolean {
  return isRecoverableStalledApproval(run)
    && nonBlank(run.branch)
    && nonBlank(run.commitSha)
    && reviewGateSatisfied(context, run)
}

function isRecoverableStalledApproval(run: Run): boolean {
  return run.stage === 'ship'
    && run.pendingApproval
    && run.terminalState === 'stalled'
    && run.failReason != null
    && RECOVERABLE_STALLED_APPROVAL_REASONS.has(run.failReason)
}

function reviewGateSatisfied(context: ApiContext, run: Run): boolean {
  if (!context.enforcement.isExternalReviewRequired(run.id)) return true
  return run.ciStatus === 'pass' && run.reviewStatus === 'pass'
}

function restoreStalledApproval(context: ApiContext, run: Run): Run {
  const reason = run.failReason ?? 'unknown restart stall'
  context.repos.runUpdates.create(run.id, `cleared ${reason} metadata before approval merge`)
  context.repos.runs.updateTerminalState(run.id, null)
  context.repos.runs.updateFailure(run.id, null, true)
  context.repos.runs.updateWorkflowState(run.id, {
    blockedReason: null,
    pendingApproval: true,
  })
  return requireRun(context, run.id)
}

function assertNoOpenDescendantRuns(context: ApiContext, runId: RunId): void {
  const runs = context.repos.runs.listAll({ limit: 10_000 })
  const blockers = listOpenDescendantRuns(runs, runId)
  if (blockers.length === 0) return
  const preview = blockers.slice(0, 3).map((run) => `${run.id.slice(0, 8)}:${run.stage}`).join(', ')
  const suffix = blockers.length > 3 ? `, +${blockers.length - 3} more` : ''
  throw new ValidationError(
    `Run ${runId.slice(0, 8)} cannot be approved while descendant work is still active (${preview}${suffix})`,
  )
}

export async function rejectRun(context: ApiContext, runId: RunId, reason: string) {
  const run = requireRun(context, runId)
  if (!run.pendingApproval) {
    throw new ValidationError(run.blockedReason ?? `Run ${runId} does not require approval`)
  }
  const auditReason = `approval rejected: ${reason}`
  // Atomic gate commit: the rejection verdict, its evidence, and the run-state failure are written
  // all-or-nothing so a crash mid-rejection can never leave a verdict without its evidence (or vice
  // versa). The async Edictum runtime teardown stays outside the synchronous transaction.
  context.db.transaction(() => {
    context.repos.runUpdates.create(runId, auditReason)
    addEvidence(context, runId, 'review', { passed: false, reason, source: 'operator_rejection' })
    context.repos.gateEvaluations.create({
      runId,
      gateType: 'gate_check',
      target: 'approval.reject',
      result: 'blocked',
      reason,
      observed: false,
    })
    context.stateMachine.markFailed(runId, auditReason)
    context.repos.runs.updateFailure(runId, auditReason, true)
  })()
  context.enforcement.disposeRuntime(runId)
  return requireRun(context, runId)
}
