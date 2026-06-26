import { syncRunGitArtifacts, validateEvidencePayload, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { requireRun } from './common.js'
import {
  assertBranchContainsBase,
  assertCleanWorktree,
  branchRefExists,
  checkoutBaseBranch,
  resolveRunGitContext,
} from './merge-context.js'
import { mergeViaLocalBranch, mergeViaPullRequest } from './merge-drivers.js'
import { finalizeSuccessfulMerge } from './merge-finalize.js'
import type { MergeOptions, MergeResult, RunGitContext } from './merge-types.js'
import { hasPrReference, isPrBackedExternalReviewRun, resolveKnownBranch } from './merge-utils.js'
import { nonBlank } from './common.js'

export type { MergeOptions, MergeResult } from './merge-types.js'

export async function mergeApprovedRun(
  context: ApiContext,
  runId: RunId,
  options: MergeOptions = {},
): Promise<MergeResult> {
  let run = requireRun(context, runId)
  const base = options.base ?? 'main'
  const fallbackUpstreamPath = resolveFallbackUpstreamPath(context, run)
  let git: RunGitContext
  try {
    git = await resolveRunGitContext(run)
  } catch (error) {
    if (isMissingWorktreeError(error) && canUseFallbackBranch(run, fallbackUpstreamPath)) {
      context.repos.runUpdates.create(
        runId,
        'approval worktree was already cleaned up; merging recorded branch from repository path',
      )
      git = { upstreamPath: fallbackUpstreamPath }
    } else if (isMissingWorktreeError(error) && hasZeroDiffWorktreeSnapshot(context, runId)) {
      context.repos.runUpdates.create(runId, 'approved no-op run; recorded worktree was already cleaned up')
      context.stateMachine.markDone(runId, 'approved (missing worktree; zero-diff snapshot)')
      context.dag.onRunComplete(runId)
      context.enforcement.disposeRuntime(runId)
      return { pushed: false }
    } else {
      throw error
    }
  }
  if (!nonBlank(git.upstreamPath) && canUseFallbackBranch(run, fallbackUpstreamPath)) {
    context.repos.runUpdates.create(runId, 'approval has no live worktree; merging recorded branch from repository path')
    git = { ...git, upstreamPath: fallbackUpstreamPath }
  }
  if (nonBlank(git.worktreePath)) {
    const synced = await syncRunGitArtifacts(context.repos.runs, runId, git.worktreePath)
    if (synced != null) run = synced
  }
  await assertCleanWorktree(git.worktreePath)
  if (git.upstreamPath !== git.worktreePath) await assertCleanWorktree(git.upstreamPath, 'merge target')

  const shouldMergePullRequest = hasPrReference(run) || isPrBackedExternalReviewRun(context, runId, run)
  if (shouldMergePullRequest) await assertPrMergeBranchContainsBase(run, git, base)

  const result = shouldMergePullRequest
    ? await mergeViaPullRequest(run, git, options, runId, context)
    : await mergeViaLocalBranch(context, runId, run, git, options)

  await finalizeSuccessfulMerge(context, runId, result, git, base)
  return result
}

function resolveFallbackUpstreamPath(context: ApiContext, run: Pick<Run, 'taskId'>): string | undefined {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return undefined
  const repository = context.repos.repositories.get(task.repositoryId as never)
  return repository?.spec.localPath
}

function canUseFallbackBranch(
  run: Pick<Run, 'branch' | 'commitSha'>,
  fallbackUpstreamPath: string | undefined,
): fallbackUpstreamPath is string {
  return nonBlank(fallbackUpstreamPath) && nonBlank(run.branch) && nonBlank(run.commitSha)
}

async function assertPrMergeBranchContainsBase(run: Run, git: RunGitContext, base: string): Promise<void> {
  if (!nonBlank(git.upstreamPath)) return
  const branch = resolveKnownBranch(run, git)
  if (!nonBlank(branch) || branch === base || branch === 'HEAD') return
  if (!await branchRefExists(git.upstreamPath, branch)) return
  await checkoutBaseBranch(git.upstreamPath, base)
  await assertBranchContainsBase(git.upstreamPath, base, branch)
}

function hasZeroDiffWorktreeSnapshot(context: ApiContext, runId: RunId): boolean {
  return context.repos.evidence.list(runId).some((item) => {
    const payload = item.payload
    if (!validateEvidencePayload(payload) || payload.kind !== 'worktree.snapshot') return false
    return payload.diffStat.filesChanged === 0
      && payload.diffStat.insertions === 0
      && payload.diffStat.deletions === 0
  })
}

function isMissingWorktreeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('cannot change to')
}
