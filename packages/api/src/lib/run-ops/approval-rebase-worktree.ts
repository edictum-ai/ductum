import { execFile } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { Run } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { nonBlank } from './common.js'
import { assertBranchContainsCommit, resolveRunGitContext } from './merge-context.js'
import type { RunGitContext } from './merge-types.js'

const execFileAsync = promisify(execFile)

export async function prepareApprovalRebaseWorktree(
  context: ApiContext,
  run: Run,
): Promise<{ git: RunGitContext; worktreePath: string }> {
  try {
    const git = await resolveRunGitContext(run)
    if (nonBlank(git.worktreePath)) return { git, worktreePath: git.worktreePath }
  } catch (error) {
    if (!isMissingWorktreeError(error)) throw error
  }

  const upstreamPath = resolveFallbackUpstreamPath(context, run)
  const branch = run.branch
  const commitSha = run.commitSha
  if (!nonBlank(upstreamPath) || !nonBlank(branch) || !nonBlank(commitSha)) {
    throw new ValidationError(
      `Run ${run.id} has no usable worktree; approve --rebase requires a live worktree or recorded branch, commit, and repository path`,
    )
  }
  await assertBranchContainsCommit(upstreamPath, branch, commitSha)

  const root = await mkdtemp(join(tmpdir(), `ductum-approve-rebase-${run.id.slice(0, 8)}-`))
  const worktreePath = join(root, 'worktree')
  await execFileAsync(
    'git',
    ['-C', upstreamPath, 'worktree', 'prune'],
    { encoding: 'utf-8', timeout: 10_000 },
  ).catch(() => undefined)
  await execFileAsync(
    'git',
    ['-C', upstreamPath, 'worktree', 'add', '--force', worktreePath, branch],
    { encoding: 'utf-8', timeout: 30_000 },
  )
  context.repos.runs.updateWorktreePaths(run.id, [worktreePath])
  context.repos.runUpdates.create(
    run.id,
    'approval rebase recreated cleaned worktree from recorded branch',
  )

  return {
    git: { worktreePath, upstreamPath, detectedBranch: branch },
    worktreePath,
  }
}

function resolveFallbackUpstreamPath(context: ApiContext, run: Pick<Run, 'taskId'>): string | undefined {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return undefined
  const repository = context.repos.repositories.get(task.repositoryId as never)
  return repository?.spec.localPath
}

function isMissingWorktreeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('cannot change to')
}
