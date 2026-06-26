import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { nonBlank } from './common.js'
import { branchRefExists } from './merge-context.js'
import type { MergeResult, RunGitContext } from './merge-types.js'

const execFileAsync = promisify(execFile)

export async function finalizeSuccessfulMerge(
  context: ApiContext,
  runId: RunId,
  result: MergeResult,
  git: RunGitContext,
  base: string,
): Promise<void> {
  const worktreePath = git.worktreePath
  const upstreamPath = git.upstreamPath
  const branch = result.branch

  if (nonBlank(worktreePath)) {
    const descendantsToKill: RunId[] = []
    for (const candidate of context.repos.runs.getActive()) {
      if (candidate.id === runId || candidate.worktreePaths == null) continue
      if (candidate.worktreePaths.includes(worktreePath)) descendantsToKill.push(candidate.id)
    }
    for (const id of descendantsToKill) {
      log.info('merge', `killing descendant run ${id.slice(0, 8)} sharing worktree ${worktreePath}`)
      if (context.killRun != null) await context.killRun(id).catch(() => undefined)
      context.stateMachine.markDone(id, `merged via ancestor run ${runId.slice(0, 8)}`)
      context.dag.onRunComplete(id)
      context.enforcement.disposeRuntime(id)
    }
  }

  if (nonBlank(upstreamPath) && nonBlank(worktreePath)) {
    try {
      await execFileAsync(
        'git',
        ['-C', upstreamPath, 'worktree', 'remove', worktreePath, '--force'],
        { encoding: 'utf-8', timeout: 10_000 },
      )
    } catch (error) {
      log.warn('merge', `worktree remove failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (
    nonBlank(upstreamPath)
    && nonBlank(branch)
    && branch !== base
    && branch !== 'HEAD'
    && await branchRefExists(upstreamPath, branch)
  ) {
    try {
      await execFileAsync(
        'git',
        ['-C', upstreamPath, 'branch', '-D', branch],
        { encoding: 'utf-8', timeout: 5_000 },
      )
    } catch (error) {
      log.warn('merge', `branch delete failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const mergeTarget = nonBlank(branch) ? branch : 'approved run'
  context.stateMachine.markDone(runId, `merged ${mergeTarget} into ${base}${result.pushed ? ' and pushed' : ''}`)
  context.dag.onRunComplete(runId)
  context.enforcement.disposeRuntime(runId)

  let cursor: Run | null = context.repos.runs.get(runId)
  while (cursor != null && cursor.parentRunId != null) {
    const parent = context.repos.runs.get(cursor.parentRunId)
    if (parent == null) break
    if (parent.stage !== 'done' && parent.terminalState == null) {
      context.stateMachine.markDone(parent.id, `merged via descendant run ${runId.slice(0, 8)}`)
      context.dag.onRunComplete(parent.id)
      context.enforcement.disposeRuntime(parent.id)
    }
    cursor = parent
  }

  clearDoneLineageApprovalState(context, runId)
}

function clearDoneLineageApprovalState(context: ApiContext, runId: RunId): void {
  let cursor: Run | null = context.repos.runs.get(runId)
  while (cursor != null) {
    if (cursor.stage === 'done' && (cursor.pendingApproval || cursor.blockedReason != null)) {
      context.repos.runs.updateWorkflowState(cursor.id, {
        blockedReason: null,
        pendingApproval: false,
      })
    }
    cursor = cursor.parentRunId == null ? null : context.repos.runs.get(cursor.parentRunId)
  }
}
