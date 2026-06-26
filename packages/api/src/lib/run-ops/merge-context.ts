import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { buildStaleApprovalFailureReason, type Run } from '@ductum/core'
import { nonBlank } from './common.js'
import type { RunGitContext } from './merge-types.js'

const execFileAsync = promisify(execFile)

export async function resolveRunGitContext(run: Pick<Run, 'worktreePaths'>): Promise<RunGitContext> {
  const worktreePath = run.worktreePaths?.[0]
  if (!nonBlank(worktreePath)) return {}
  try {
    const { stdout: commonDir } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    let detectedBranch: string | undefined
    try {
      const { stdout: branchOut } = await execFileAsync(
        'git',
        ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf-8', timeout: 5_000 },
      )
      const trimmed = branchOut.trim()
      detectedBranch = trimmed === '' ? undefined : trimmed
    } catch {
      detectedBranch = undefined
    }
    return {
      worktreePath,
      upstreamPath: commonDir.trim().replace(/\/?\.git\/?$/, '') || worktreePath,
      detectedBranch,
    }
  } catch (error) {
    throw new Error(`could not resolve worktree git state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function assertCleanWorktree(worktreePath?: string, label = 'worktree'): Promise<void> {
  if (!nonBlank(worktreePath)) return
  const { stdout: dirty } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'status', '--porcelain'],
    { encoding: 'utf-8', timeout: 5_000 },
  )
  if (dirty.trim() !== '') {
    throw new Error(`${label} has uncommitted changes: ${dirty.trim().split('\n').slice(0, 5).join('; ')}`)
  }
}

export async function checkoutBaseBranch(upstreamPath: string, base: string): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'checkout', base],
      { encoding: 'utf-8', timeout: 10_000 },
    )
  } catch (error) {
    throw new Error(`could not checkout ${base}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function assertBranchContainsBase(
  upstreamPath: string,
  base: string,
  branch: string,
): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'merge-base', '--is-ancestor', base, branch],
      { encoding: 'utf-8', timeout: 5_000 },
    )
  } catch {
    throw new Error(buildStaleApprovalFailureReason(branch, base))
  }
}

export async function assertCommitContainsBase(
  upstreamPath: string,
  baseRevision: string,
  commitSha: string,
  label: string,
  baseLabel = baseRevision,
): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'merge-base', '--is-ancestor', baseRevision, commitSha],
      { encoding: 'utf-8', timeout: 5_000 },
    )
  } catch {
    throw new Error(buildStaleApprovalFailureReason(label, baseLabel))
  }
}

export async function branchRefExists(upstreamPath: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'rev-parse', '--verify', '--quiet', `${branch}^{commit}`],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    return true
  } catch {
    return false
  }
}

export async function assertBranchContainsCommit(
  upstreamPath: string,
  branch: string,
  commitSha: string,
): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'merge-base', '--is-ancestor', commitSha, branch],
      { encoding: 'utf-8', timeout: 5_000 },
    )
  } catch {
    throw new Error(`recorded approval commit ${commitSha} is not contained in branch ${branch}`)
  }
}
