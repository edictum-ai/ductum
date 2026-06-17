import { syncRunGitArtifacts, validateEvidencePayload, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { requireRun } from './common.js'
import { assertCleanWorktree, resolveRunGitContext } from './merge-context.js'
import { mergeViaLocalBranch, mergeViaPullRequest } from './merge-drivers.js'
import { finalizeSuccessfulMerge } from './merge-finalize.js'
import type { MergeOptions, MergeResult, RunGitContext } from './merge-types.js'
import { isPrBackedExternalReviewRun } from './merge-utils.js'
import { nonBlank } from './common.js'

export type { MergeOptions, MergeResult } from './merge-types.js'

export async function mergeApprovedRun(
  context: ApiContext,
  runId: RunId,
  options: MergeOptions = {},
): Promise<MergeResult> {
  let run = requireRun(context, runId)
  const base = options.base ?? 'main'
  let git: RunGitContext
  try {
    git = await resolveRunGitContext(run)
  } catch (error) {
    if (isMissingWorktreeError(error) && hasZeroDiffWorktreeSnapshot(context, runId)) {
      context.repos.runUpdates.create(runId, 'approved no-op run; recorded worktree was already cleaned up')
      context.stateMachine.markDone(runId, 'approved (missing worktree; zero-diff snapshot)')
      context.dag.onRunComplete(runId)
      context.enforcement.disposeRuntime(runId)
      return { pushed: false }
    }
    throw error
  }
  if (nonBlank(git.worktreePath)) {
    const synced = await syncRunGitArtifacts(context.repos.runs, runId, git.worktreePath)
    if (synced != null) run = synced
  }
  await assertCleanWorktree(git.worktreePath)

  const result = isPrBackedExternalReviewRun(context, runId, run)
    ? await mergeViaPullRequest(run, git, options, runId, context)
    : await mergeViaLocalBranch(context, runId, run, git, options)

  if (!nonBlank(git.worktreePath) && !isPrBackedExternalReviewRun(context, runId, run)) {
    return result
  }

  await finalizeSuccessfulMerge(context, runId, result, git, base)
  return result
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
