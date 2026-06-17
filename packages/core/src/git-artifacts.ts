import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import type { RunRepo } from './repos/interfaces.js'
import type { Run, RunId } from './types.js'

const execFileAsync = promisify(execFile)

export interface WorktreeGitArtifacts {
  branch?: string
  commitSha?: string
}

function nonBlank(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function cleanBranch(value: string | undefined): string | undefined {
  if (!nonBlank(value)) return undefined
  const trimmed = value.trim()
  if (trimmed === 'HEAD') return undefined
  return trimmed
}

async function gitOutput(worktreePath: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, ...args], {
      encoding: 'utf-8',
      timeout: 5_000,
    })
    const trimmed = stdout.trim()
    return trimmed === '' ? undefined : trimmed
  } catch {
    return undefined
  }
}

export async function readWorktreeGitArtifacts(worktreePath: string): Promise<WorktreeGitArtifacts> {
  if (!existsSync(worktreePath)) return {}

  const [branch, commitSha] = await Promise.all([
    gitOutput(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOutput(worktreePath, ['rev-parse', 'HEAD']),
  ])
  return {
    ...(cleanBranch(branch) == null ? {} : { branch: cleanBranch(branch) }),
    ...(nonBlank(commitSha) ? { commitSha } : {}),
  }
}

export async function syncRunGitArtifacts(
  runRepo: Pick<RunRepo, 'get' | 'updateGitArtifacts'>,
  runId: RunId,
  worktreePath: string,
): Promise<Run | null> {
  const current = runRepo.get(runId)
  if (current == null) return null

  const artifacts = await readWorktreeGitArtifacts(worktreePath)
  const fields: Partial<Pick<Run, 'branch' | 'commitSha'>> = {}
  if (artifacts.branch != null && current.branch !== artifacts.branch) {
    fields.branch = artifacts.branch
  }
  if (artifacts.commitSha != null && current.commitSha !== artifacts.commitSha) {
    fields.commitSha = artifacts.commitSha
  }

  if (Object.keys(fields).length === 0) return null
  return runRepo.updateGitArtifacts(runId, fields)
}
