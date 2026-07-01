import {
  createId,
  findExternalOutcome,
  isExternalOutcome,
  type Evidence,
  type EvidenceId,
  type ExternalOutcome,
  type Run,
  type RunId,
} from '@ductum/core'

import { cleanupAttemptArtifacts, type AttemptArtifactCleanupReport } from './attempt-cleanup-artifacts.js'
import type { ApiContext } from './deps.js'
import { ConflictError } from './errors.js'
import { requireRun } from './operator-run-guards.js'

export interface FailedAttemptCleanupResult extends AttemptArtifactCleanupReport {
  run: Run
  cleanupAt: string
  externalOutcome: {
    runId: RunId
    outcome: ExternalOutcome
    reason: string
  }
  evidenceId: EvidenceId
}

export async function cleanupFailedAttemptWorktree(
  context: ApiContext,
  runId: RunId,
): Promise<FailedAttemptCleanupResult> {
  const run = requireRun(context, runId)
  if (run.terminalState !== 'failed' && run.terminalState !== 'cancelled') {
    throw new ConflictError(`Run ${run.id} is not a terminal failed or cancelled attempt`)
  }
  const worktreePaths = run.worktreePaths ?? []
  if (worktreePaths.length === 0) {
    throw new ConflictError(`Run ${run.id} has no preserved worktree to clean`)
  }

  const externalOutcome = run.terminalState === 'cancelled'
    ? trustedCancelledOutcome(run)
    : findTrustedTaskExternalOutcome(context, run)
  if (externalOutcome == null) {
    throw new ConflictError(
      `Run ${run.id} cannot be cleaned without a trusted task-level external outcome`,
    )
  }

  const cleanupAt = context.now().toISOString()
  const report = await cleanupAttemptArtifacts(run.id, worktreePaths)

  return context.db.transaction(() => {
    context.repos.runs.updateWorktreePaths(run.id, null)
    const evidence = context.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: run.terminalState === 'cancelled'
          ? 'operator.cancelled-attempt-cleanup'
          : 'operator.failed-attempt-cleanup',
        cleanupAt,
        removedWorktreePaths: report.removedWorktreePaths,
        generatedPaths: report.generatedPaths,
        branchOutcomes: report.branchOutcomes,
        externalOutcome,
      },
    })
    context.repos.runUpdates.create(
      run.id,
      run.terminalState === 'cancelled'
        ? `operator cleaned preserved cancelled-attempt worktree (${externalOutcome.reason})`
        : `operator cleaned preserved failed-attempt worktree after trusted external outcome (${externalOutcome.outcome})`,
    )
    return {
      run: requireRun(context, run.id),
      cleanupAt,
      externalOutcome,
      evidenceId: evidence.id,
      ...report,
    }
  })()
}

function trustedCancelledOutcome(run: Run): FailedAttemptCleanupResult['externalOutcome'] {
  return {
    runId: run.id,
    outcome: 'superseded',
    reason: run.failReason?.trim() || 'operator cancelled attempt',
  }
}

function findTrustedTaskExternalOutcome(
  context: ApiContext,
  run: Run,
): FailedAttemptCleanupResult['externalOutcome'] | null {
  for (const candidate of context.repos.runs.list(run.taskId).toReversed()) {
    if (candidate.stage !== 'done') continue
    const evidence = context.repos.evidence.list(candidate.id)
    const outcome = findExternalOutcome(evidence)
    if (outcome != null && isExternalOutcome(outcome)) {
      const reason = findExternalOutcomeReason(evidence, outcome)
      if (reason != null) {
        return { runId: candidate.id, outcome, reason }
      }
    }
    const mergedReason = findSiblingMergedOutcomeReason(candidate, evidence)
    if (mergedReason != null) {
      return { runId: candidate.id, outcome: 'done', reason: mergedReason }
    }
  }
  return null
}

function findExternalOutcomeReason(evidence: readonly Evidence[], outcome: ExternalOutcome): string | null {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const item = evidence[index]
    if (item?.type !== 'custom') continue
    if (item.payload.kind !== 'external-outcome') continue
    if (item.payload.outcome !== outcome) continue
    return typeof item.payload.reason === 'string' && item.payload.reason.trim() !== ''
      ? item.payload.reason
      : null
  }
  return null
}

function findSiblingMergedOutcomeReason(run: Run, evidence: readonly Evidence[]): string | null {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const item = evidence[index]
    if (item?.type !== 'custom' || item.payload.kind !== 'github-pr-merge') continue
    const prNumber = typeof item.payload.prNumber === 'number' ? item.payload.prNumber : run.prNumber
    const prLabel = prNumber == null ? 'a sibling GitHub lifecycle PR' : `sibling merged GitHub PR #${prNumber}`
    return `cleanup trusted because ${prLabel} already landed for this task`
  }
  return null
}
