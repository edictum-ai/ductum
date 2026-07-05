import {
  buildStaleApprovalDenyReason,
  parseStaleApprovalFailureReason,
  quoteCliArg,
  readWorktreeGitArtifacts,
  syncRunGitArtifacts,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext, MergeStrategy } from '../deps.js'
import { ValidationError } from '../errors.js'
import { parseGitHubPullRef, type GitHubRepoRef } from '../github-ref.js'
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

export function resolveGitHubPullNumber(run: RunPrRef, repo: GitHubRepoRef): number {
  if (nonBlank(run.prUrl)) {
    const pullRef = parseGitHubPullRef(run.prUrl)
    if (pullRef == null) {
      throw new ValidationError(`Unsupported GitHub pull request URL: ${run.prUrl}`)
    }
    if (!sameGitHubRepo(pullRef, repo)) {
      throw new ValidationError('PR URL does not match repository remote')
    }
    return pullRef.pullNumber
  }
  if (typeof run.prNumber === 'number') return run.prNumber
  throw new ValidationError('PR-backed GitHub API merge requires prNumber or a GitHub pull request URL')
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

function sameGitHubRepo(left: GitHubRepoRef, right: GitHubRepoRef): boolean {
  return left.host.toLowerCase() === right.host.toLowerCase()
    && left.owner.toLowerCase() === right.owner.toLowerCase()
    && left.repo.toLowerCase() === right.repo.toLowerCase()
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

/**
 * Issue #243 / dogfood PR #271: sync git artifacts from a rebased worktree
 * back into the run record without clobbering PR identity evidence.
 *
 * For PR-backed runs, run.branch is the recorded PR head branch (PR identity
 * evidence that the merge path's `assertPullRequestStateMatchesRun` compares
 * against the live PR head branch). The approve-rebase worktree is often on a
 * local `ductum/github-lifecycle-*` checkout branch — letting
 * `syncRunGitArtifacts` overwrite run.branch from that worktree destroys the
 * PR identity and the merge path fails closed with the dogfood mismatch:
 *
 *   PR head branch "feat/..." does not match recorded branch "ductum/github-lifecycle-..."
 *
 * For PR-backed runs, sync only the rebased `commitSha`; preserve `run.branch`.
 * For non-PR-backed runs, mirror `syncRunGitArtifacts`'s full branch+sha sync
 * (the existing local-merge behavior is unchanged).
 */
export async function syncRunGitArtifactsPreservingPrIdentity(
  context: ApiContext,
  run: Run,
  worktreePath: string,
): Promise<Run | null> {
  if (!hasPrReference(run)) {
    return syncRunGitArtifacts(context.repos.runs, run.id, worktreePath)
  }
  const artifacts = await readWorktreeGitArtifacts(worktreePath)
  if (artifacts.commitSha == null) return null
  if (run.commitSha === artifacts.commitSha) return null
  return context.repos.runs.updateGitArtifacts(run.id, { commitSha: artifacts.commitSha })
}
