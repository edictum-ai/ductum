import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const AUTO_BRANCH_PREFIXES = ['ductum/'] as const
const AUTO_BRANCH_PATTERNS = [/^feat\/p\d+-[A-Za-z0-9._-]+$/, /^fix\/p\d+-[A-Za-z0-9._-]+$/] as const

export interface CleanupPathOutcome {
  path: string
  outcome: 'removed' | 'retained'
  reason: string
}

export interface CleanupBranchOutcome {
  branch: string | null
  outcome: 'removed' | 'retained'
  reason: string
  repoPath: string | null
  worktreePath: string | null
}

export interface AttemptArtifactCleanupReport {
  removedWorktreePaths: string[]
  generatedPaths: CleanupPathOutcome[]
  branchOutcomes: CleanupBranchOutcome[]
}

interface WorktreeGitContext {
  repoPath: string | null
  branch: string | null
}

export async function cleanupAttemptArtifacts(
  runId: string,
  worktreePaths: readonly string[],
): Promise<AttemptArtifactCleanupReport> {
  const removedWorktreePaths: string[] = []
  const generatedPaths: CleanupPathOutcome[] = []
  const branchOutcomes: CleanupBranchOutcome[] = []

  for (const worktreePath of worktreePaths) {
    const git = await inspectWorktreeGitContext(worktreePath)
    const worktreeRemoved = await removeWorktreePath(worktreePath, git.repoPath)
    if (worktreeRemoved) removedWorktreePaths.push(worktreePath)

    generatedPaths.push(...await cleanupGeneratedCodexHome(runId, worktreePath))
    branchOutcomes.push(await cleanupLocalAutoBranch(git, worktreePath))
  }

  return { removedWorktreePaths, generatedPaths, branchOutcomes }
}

async function inspectWorktreeGitContext(worktreePath: string): Promise<WorktreeGitContext> {
  if (!existsSync(worktreePath)) return { repoPath: null, branch: null }
  try {
    const [commonDir, branch] = await Promise.all([
      execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
        encoding: 'utf-8',
        timeout: 5_000,
      }),
      execFileAsync('git', ['-C', worktreePath, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
        encoding: 'utf-8',
        timeout: 5_000,
      }).catch(() => ({ stdout: '' })),
    ])
    return {
      repoPath: resolve(commonDir.stdout.trim(), '..'),
      branch: normalize(branch.stdout),
    }
  } catch {
    return { repoPath: null, branch: null }
  }
}

async function removeWorktreePath(worktreePath: string, repoPath: string | null): Promise<boolean> {
  if (!existsSync(worktreePath)) return false
  if (repoPath != null) {
    try {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'remove', worktreePath, '--force'], {
        encoding: 'utf-8',
        timeout: 10_000,
      })
      return true
    } catch {
      // Fall through to direct removal.
    }
  }
  await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
  return !existsSync(worktreePath)
}

async function cleanupGeneratedCodexHome(runId: string, worktreePath: string): Promise<CleanupPathOutcome[]> {
  const outcomes: CleanupPathOutcome[] = []
  const runCachePath = join(dirname(worktreePath), '.codex-home', safePathSegment(runId))
  const parentPath = dirname(runCachePath)

  if (existsSync(runCachePath)) {
    await rm(runCachePath, { recursive: true, force: true }).catch(() => undefined)
    outcomes.push({
      path: runCachePath,
      outcome: existsSync(runCachePath) ? 'retained' : 'removed',
      reason: existsSync(runCachePath) ? 'generated Codex home removal failed' : 'removed generated Codex home',
    })
  }

  if (existsSync(parentPath) && (await isDirectoryEmpty(parentPath))) {
    await rm(parentPath, { recursive: true, force: true }).catch(() => undefined)
    outcomes.push({
      path: parentPath,
      outcome: existsSync(parentPath) ? 'retained' : 'removed',
      reason: existsSync(parentPath) ? 'generated Codex home parent removal failed' : 'removed empty generated Codex home parent',
    })
  }

  return outcomes
}

async function cleanupLocalAutoBranch(
  git: WorktreeGitContext,
  worktreePath: string,
): Promise<CleanupBranchOutcome> {
  if (git.branch == null) {
    return retainedBranch(null, 'worktree had no local branch to remove', git.repoPath, worktreePath)
  }
  if (!isDuctumAutoBranch(git.branch)) {
    return retainedBranch(git.branch, 'branch is not a Ductum auto branch', git.repoPath, worktreePath)
  }
  if (git.repoPath == null) {
    return retainedBranch(git.branch, 'could not resolve parent repository for branch cleanup', null, worktreePath)
  }
  try {
    await execFileAsync('git', ['-C', git.repoPath, 'rev-parse', '--verify', `refs/heads/${git.branch}`], {
      encoding: 'utf-8',
      timeout: 5_000,
    })
  } catch {
    return retainedBranch(git.branch, 'local branch no longer exists', git.repoPath, worktreePath)
  }

  try {
    await execFileAsync('git', ['-C', git.repoPath, 'branch', '-D', git.branch], {
      encoding: 'utf-8',
      timeout: 5_000,
    })
    return {
      branch: git.branch,
      outcome: 'removed',
      reason: 'removed local Ductum auto branch',
      repoPath: git.repoPath,
      worktreePath,
    }
  } catch (error) {
    return retainedBranch(
      git.branch,
      `branch removal failed: ${error instanceof Error ? error.message : String(error)}`,
      git.repoPath,
      worktreePath,
    )
  }
}

function retainedBranch(
  branch: string | null,
  reason: string,
  repoPath: string | null,
  worktreePath: string | null,
): CleanupBranchOutcome {
  return { branch, outcome: 'retained', reason, repoPath, worktreePath }
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0
  } catch {
    return false
  }
}

function normalize(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function isDuctumAutoBranch(branch: string): boolean {
  return AUTO_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix))
    || AUTO_BRANCH_PATTERNS.some((pattern) => pattern.test(branch))
}

function safePathSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_')
  return segment === '' ? 'default' : segment
}
