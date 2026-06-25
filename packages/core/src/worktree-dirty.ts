import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const IGNORED_DIR_PREFIXES = [
  '.pnpm-store/',
] as const

export interface TrackedWorktreeChanges {
  files: string[]
  error?: string
}

export interface DirtyWorktreeSnapshot {
  worktreePath: string
  trackedPaths: string[]
  untrackedPaths: string[]
  relevantPaths: string[]
  ignoredPaths: string[]
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

export async function inspectDirtyWorktree(worktreePath: string): Promise<DirtyWorktreeSnapshot> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf-8', timeout: 10_000 },
  )
  const trackedPaths: string[] = []
  const untrackedPaths: string[] = []
  const ignoredPaths: string[] = []
  const relevantPaths: string[] = []

  for (const line of stdout.split('\n')) {
    const parsed = parsePorcelainLine(line)
    if (parsed == null) continue
    if (parsed.untracked) untrackedPaths.push(parsed.path)
    else trackedPaths.push(parsed.path)
    if (isIgnoredDirtyPath(parsed.path)) ignoredPaths.push(parsed.path)
    else relevantPaths.push(parsed.path)
  }

  return {
    worktreePath,
    trackedPaths: uniqueSorted(trackedPaths),
    untrackedPaths: uniqueSorted(untrackedPaths),
    relevantPaths: uniqueSorted(relevantPaths),
    ignoredPaths: uniqueSorted(ignoredPaths),
  }
}

export async function inspectDirtyWorktrees(
  worktreePaths: readonly string[],
): Promise<DirtyWorktreeSnapshot[]> {
  const snapshots: DirtyWorktreeSnapshot[] = []
  for (const worktreePath of worktreePaths) {
    try {
      const snapshot = await inspectDirtyWorktree(worktreePath)
      if (snapshot.trackedPaths.length > 0 || snapshot.untrackedPaths.length > 0) snapshots.push(snapshot)
    } catch {
      // Missing or invalid worktrees are ignored here; callers decide how to fail.
    }
  }
  return snapshots
}

export function hasRelevantDirtyWorktree(
  snapshots: readonly DirtyWorktreeSnapshot[],
): boolean {
  return snapshots.some((snapshot) => snapshot.relevantPaths.length > 0)
}

function parsePorcelainLine(line: string): { path: string; untracked: boolean } | null {
  if (line.trim() === '' || line.length < 4) return null
  const status = line.slice(0, 2)
  const rawPath = normalizeStatusPath(line.slice(3))
  if (rawPath == null) return null
  return { path: rawPath, untracked: status === '??' }
}

function normalizeStatusPath(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const renamedPath = trimmed.includes(' -> ') ? trimmed.split(' -> ').at(-1)! : trimmed
  return renamedPath.replace(/^"(.*)"$/, '$1').trim() || null
}

function isIgnoredDirtyPath(value: string): boolean {
  return IGNORED_DIR_PREFIXES.some((prefix) => value === prefix.slice(0, -1) || value.startsWith(prefix))
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
