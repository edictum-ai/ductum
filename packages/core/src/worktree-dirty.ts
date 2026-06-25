import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface TrackedWorktreeChanges {
  files: string[]
  error?: string
}

export async function readTrackedWorktreeChanges(worktreePath: string): Promise<TrackedWorktreeChanges> {
  if (!existsSync(worktreePath)) return { files: [] }
  if (!existsSync(join(worktreePath, '.git'))) return { files: [] }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    return {
      files: stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    }
  } catch (error) {
    return {
      files: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function summarizeTrackedWorktreeChanges(changes: TrackedWorktreeChanges, limit = 10): string {
  if (changes.error != null) return `worktree cleanliness check failed: ${changes.error}`
  if (changes.files.length === 0) return 'no tracked changes'
  const visible = changes.files.slice(0, limit).join('; ')
  const suffix = changes.files.length > limit ? `; +${changes.files.length - limit} more` : ''
  return `${visible}${suffix}`
}
