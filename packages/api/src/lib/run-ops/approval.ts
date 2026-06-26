import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  STARTUP_DEAD_CLAIM_REASON,
  STARTUP_NO_MAPPING_REASON,
  STARTUP_RESUME_SCHEDULED_REASON,
  STARTUP_RESUME_UNAVAILABLE_REASON,
  STARTUP_STALLED_REASON,
  createId,
  evaluateUnattendedApproval,
  hasCurrentCommitRemoteCiPass,
  hasCurrentCommitReviewPass,
  isUnattendedApprovalBlockedReason,
  syncRunGitArtifacts,
  UNATTENDED_APPROVAL_BLOCKED_PREFIX,
  type Run,
  type RunId,
} from '@ductum/core'
import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { listBlockingApprovalDescendants } from '../approval-descendants.js'
import { addEvidence } from './evidence.js'
import { mergeApprovedRun } from './merge.js'
import type { MergeResult } from './merge-types.js'
import { buildApproveFailureRecovery, hasPrReference, isPrBackedExternalReviewRun, mergeAuditMessage, resetRunAfterMergeFailure } from './merge-utils.js'
import { nonBlank, requireRun } from './common.js'
import { resolveCurrentPrHeadSha } from './pr-head.js'
const execFileAsync = promisify(execFile)
const STALE_SLOT_GC_REASON = 'stale_slot_gc'
const RECOVERABLE_STALLED_APPROVAL_REASONS = new Set<string>([STALE_SLOT_GC_REASON, STARTUP_DEAD_CLAIM_REASON, STARTUP_RESUME_UNAVAILABLE_REASON, STARTUP_RESUME_SCHEDULED_REASON, STARTUP_STALLED_REASON, STARTUP_NO_MAPPING_REASON])
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

export async function approveRun(
  context: ApiContext,
  runId: RunId,
  options: { reason?: string; unattended?: boolean } = {},
): Promise<ApproveRunResult> {
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
  const prHeadGuard = await guardStalePrHeadApproval(context, run)
  if (prHeadGuard != null) return prHeadGuard
  if (options.unattended === true) {
    run = await syncRunForUnattendedApproval(context, run)
    const decision = evaluateUnattendedApproval({
      run,
      evidence: context.repos.evidence.list(runId),
      push: context.merge.push === true,
      hasOpenDescendants: listBlockingApprovalDescendants(context, runId).length > 0,
      budget: buildUnattendedBudget(context, run),
      gitClean: await isRunGitClean(run),
    })
    if (!decision.allowed) return stopUnattendedApproval(context, run, decision.reasons, decision.recovery)
    if (isUnattendedApprovalBlockedReason(run.blockedReason)) {
      context.repos.runs.updateWorkflowState(run.id, { blockedReason: null, pendingApproval: true })
      run = requireRun(context, run.id)
    }
  }
  context.repos.runUpdates.create(runId, approvalAuditMessage(options.reason))
  context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: {
      kind: 'operator-approval',
      actorType: 'operator',
      actorLabel: 'operator',
      unattended: options.unattended === true,
      ...(options.reason == null || options.reason.trim() === '' ? {} : { reason: options.reason.trim() }),
    },
  })

  let merge: MergeResult
  try {
    merge = await mergeApprovedRun(context, runId, {
      push: context.merge.push ?? false,
      base: context.merge.base ?? 'main',
      strategy: context.merge.strategy ?? 'merge',
      pushTags: context.merge.pushTags ?? false,
      requirePush: options.unattended === true && context.merge.push === true,
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

function stopUnattendedApproval(
  context: ApiContext,
  run: Run,
  reasons: string[],
  recovery: string,
): ApproveRunResult {
  const reason = `${UNATTENDED_APPROVAL_BLOCKED_PREFIX} ${reasons.join('; ')}`
  context.repos.runUpdates.create(run.id, `${reason}. ${recovery}`)
  context.repos.gateEvaluations.create({
    runId: run.id,
    gateType: 'gate_check',
    target: 'approval.unattended',
    result: 'blocked',
    reason,
    observed: false,
  })
  context.repos.runs.updateWorkflowState(run.id, { blockedReason: reason, pendingApproval: true })
  return {
    success: false,
    stage: run.stage,
    reason,
    nextCommand: `status ${run.id}`,
    followupCommand: recovery,
  }
}

async function guardStalePrHeadApproval(context: ApiContext, run: Run): Promise<ApproveRunResult | null> {
  if (!hasPrReference(run)) return null
  const currentPrHeadSha = await resolveCurrentPrHeadSha(context, run).catch(() => null)
  if (!nonBlank(currentPrHeadSha)) return null
  const guardedRun = currentPrHeadSha === run.commitSha
    ? run
    : context.repos.runs.updateGitArtifacts(run.id, { commitSha: currentPrHeadSha })
  const evidence = context.repos.evidence.list(run.id)
  const externalReviewRequired = isPrBackedExternalReviewRun(context, run.id, guardedRun)
  const reasons = [
    (run.ciStatus === 'pass' || currentPrHeadSha !== run.commitSha) && !hasCurrentCommitRemoteCiPass(guardedRun, evidence)
      ? 'current PR head has no passing remote CI evidence'
      : null,
    externalReviewRequired && !hasCurrentCommitReviewPass(guardedRun, evidence)
      ? 'current PR head has no passing review evidence'
      : null,
  ].filter(Boolean)
  if (reasons.length === 0) return null
  const reason = currentPrHeadSha === run.commitSha
    ? `approval blocked: current PR head ${currentPrHeadSha} lacks fresh gate evidence; ${reasons.join('; ')}`
    : `approval blocked: PR head changed from ${run.commitSha ?? 'unknown'} to ${currentPrHeadSha}; ${reasons.join('; ')}`
  context.repos.runUpdates.create(run.id, reason)
  return { success: false, stage: run.stage, reason }
}

async function syncRunForUnattendedApproval(context: ApiContext, run: Run): Promise<Run> {
  const worktreePath = run.worktreePaths?.find((path) => path.trim() !== '')
  if (worktreePath == null) return run
  const synced = await syncRunGitArtifacts(context.repos.runs, run.id, worktreePath)
  return synced ?? requireRun(context, run.id)
}

async function isRunGitClean(run: Run): Promise<boolean | undefined> {
  const paths = run.worktreePaths?.filter((path) => path.trim() !== '') ?? []
  if (paths.length === 0) return undefined
  for (const path of paths) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', path, 'status', '--porcelain'],
        { encoding: 'utf-8', timeout: 5_000 },
      )
      if (stdout.trim() !== '') return false
    } catch {
      return false
    }
  }
  return true
}

function buildUnattendedBudget(context: ApiContext, run: Run) {
  const specCostUsd = specCost(context, run)
  const runExtra = context.repos.tasks.get(run.taskId)?.budgetExtraUsd ?? 0
  return {
    perRunHardUsd:
      context.costBudget.perRunHardUsd == null
        ? undefined
        : context.costBudget.perRunHardUsd + runExtra,
    perSpecHardUsd: context.costBudget.perSpecHardUsd,
    ...(specCostUsd == null ? {} : { specCostUsd }),
  }
}

function specCost(context: ApiContext, run: Run): number | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task == null) return null
  let total = 0
  for (const candidate of context.repos.tasks.list(task.specId)) {
    for (const candidateRun of context.repos.runs.list(candidate.id)) total += candidateRun.costUsd
  }
  return total
}

function approvalAuditMessage(reason: string | undefined): string {
  const trimmed = reason?.trim()
  return trimmed ? `operator approved run; merging: ${trimmed}` : 'operator approved run; merging'
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
  const evidence = context.repos.evidence.list(run.id)
  return hasCurrentCommitRemoteCiPass(run, evidence) && hasCurrentCommitReviewPass(run, evidence)
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
  const blockers = listBlockingApprovalDescendants(context, runId)
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
