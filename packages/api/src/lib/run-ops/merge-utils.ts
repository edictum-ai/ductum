import {
  buildStaleApprovalDenyReason,
  parseStaleApprovalFailureReason,
  quoteCliArg,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext, MergeStrategy } from '../deps.js'
import type { ApproveRunResult } from './approval.js'
import { nonBlank } from './common.js'
import type { MergeResult, RunGitContext, RunPrRef } from './merge-types.js'

export function mergeAuditMessage(merge: MergeResult): string {
  const details = [
    nonBlank(merge.branch) ? `branch ${merge.branch}` : null,
    nonBlank(merge.commitSha) ? `commit ${merge.commitSha.slice(0, 12)}` : null,
    merge.pushed ? 'pushed' : 'not pushed',
  ].filter(Boolean)
  return details.length === 0
    ? 'operator approved run; no worktree merge was needed'
    : `operator approved run; merge completed (${details.join(', ')})`
}

export function hasPrReference(run: RunPrRef): boolean {
  return nonBlank(run.prUrl) || typeof run.prNumber === 'number'
}

export function isPrBackedExternalReviewRun(context: ApiContext, runId: RunId, run: Run): boolean {
  return context.enforcement.isExternalReviewRequired(runId) && hasPrReference(run)
}

export function pickPrReference(run: RunPrRef): string | null {
  if (nonBlank(run.prUrl)) return run.prUrl
  if (typeof run.prNumber === 'number') return String(run.prNumber)
  return null
}

export function resolveMergeStrategy(strategy?: MergeStrategy): MergeStrategy {
  if (strategy === 'squash' || strategy === 'rebase') return strategy
  return 'merge'
}

export function ghMergeFlag(strategy: MergeStrategy): '--merge' | '--squash' | '--rebase' {
  if (strategy === 'squash') return '--squash'
  if (strategy === 'rebase') return '--rebase'
  return '--merge'
}

export function resolveKnownBranch(
  run: Pick<Run, 'branch'>,
  git: Pick<RunGitContext, 'detectedBranch'>,
): string | undefined {
  if (nonBlank(git.detectedBranch)) return git.detectedBranch
  if (nonBlank(run.branch)) return run.branch
  return undefined
}

export function buildMergeSubject(runId: RunId, branch?: string, prNumber?: number | null): string {
  if (nonBlank(branch)) return `Merge ${branch} (run ${runId.slice(0, 8)})`
  if (typeof prNumber === 'number') return `Merge PR #${prNumber} (run ${runId.slice(0, 8)})`
  return `Merge approved run ${runId.slice(0, 8)}`
}

export async function resetRunAfterMergeFailure(
  context: ApiContext,
  runId: RunId,
  reason: string,
): Promise<Run> {
  const failReason = `merge failed: ${reason}`
  return context.repos.runs.updateFailure(runId, failReason, true)
}

export function buildApproveFailureRecovery(
  run: Pick<Run, 'id' | 'branch'>,
  reason: string,
): Pick<ApproveRunResult, 'nextCommand' | 'followupCommand'> | Record<string, never> {
  const staleApproval = parseStaleApprovalFailureReason(reason)
  if (staleApproval == null) return {}
  return {
    nextCommand: `deny ${run.id} --reason ${quoteCliArg(buildStaleApprovalDenyReason({
      branch: staleApproval.branch,
      base: staleApproval.base,
    }))}`,
    followupCommand: `retry ${run.id}`,
  }
}
