import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log, type Run, type RunId, type Task, type TaskStatus } from '@ductum/core'

import type { ApiContext } from './deps.js'

const execFileAsync = promisify(execFile)

/** Collect every run across every spec, naive but small DBs only. */
export function collectAllRuns(context: ApiContext): Run[] {
  const factory = context.repos.factory.get()
  if (factory == null) return []
  const runs: Run[] = []
  for (const project of context.repos.projects.list(factory.id)) {
    for (const spec of context.repos.specs.list(project.id)) {
      for (const task of context.repos.tasks.list(spec.id)) {
        for (const run of context.repos.runs.list(task.id)) {
          runs.push(run)
        }
      }
    }
  }
  return runs
}

/** Tasks in `status='active'` across every spec. */
export function collectActiveTasks(context: ApiContext): Task[] {
  return collectTasksByStatus(context, 'active')
}

/** Tasks matching one status across every spec. */
export function collectTasksByStatus(context: ApiContext, status: TaskStatus): Task[] {
  const factory = context.repos.factory.get()
  if (factory == null) return []
  const tasks: Task[] = []
  for (const project of context.repos.projects.list(factory.id)) {
    for (const spec of context.repos.specs.list(project.id)) {
      for (const task of context.repos.tasks.list(spec.id)) {
        if (task.status === status) tasks.push(task)
      }
    }
  }
  return tasks
}

export async function findMergeCommitForRun(
  cwd: string,
  base: string,
  runId: RunId,
  branch?: string | null,
  commitSha?: string | null,
): Promise<string | null> {
  const idPrefix = runId.slice(0, 8)
  const legacySubjectHit = await findLegacyRunSubjectMerge(cwd, base, idPrefix)
  if (legacySubjectHit != null) return legacySubjectHit

  const branchHit = await findMergeCommitContainingRef(cwd, base, branch)
  if (branchHit != null) return branchHit

  return await findMergeCommitContainingRef(cwd, base, commitSha)
}

async function findLegacyRunSubjectMerge(cwd: string, base: string, idPrefix: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-C', cwd,
        'log',
        base,
        '--max-count=500',
        '--extended-regexp',
        `--grep=\\(run ${idPrefix}\\)`,
        '--format=%H',
      ],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    const lines = stdout.trim().split('\n').filter((l) => l !== '')
    return lines[0] ?? null
  } catch (error) {
    log.warn(
      'reconcile',
      `git log scan for run ${idPrefix} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

async function findMergeCommitContainingRef(
  cwd: string,
  base: string,
  ref: string | null | undefined,
): Promise<string | null> {
  const target = await resolveCommit(cwd, ref)
  if (target == null) return null
  if (!await isAncestor(cwd, target, base)) return null
  const mergeCommit = await findFirstMergeCommitAfter(cwd, target, base)
  return mergeCommit ?? target
}

async function resolveCommit(cwd: string, ref: string | null | undefined): Promise<string | null> {
  const trimmed = ref?.trim()
  if (trimmed == null || trimmed === '' || trimmed.startsWith('-')) return null
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--verify', `${trimmed}^{commit}`],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    const sha = stdout.trim()
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null
  } catch {
    return null
  }
}

async function isAncestor(cwd: string, target: string, base: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['-C', cwd, 'merge-base', '--is-ancestor', target, base],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    return true
  } catch {
    return false
  }
}

async function findFirstMergeCommitAfter(cwd: string, target: string, base: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'log', '--max-count=1', '--merges', '--ancestry-path', `${target}..${base}`, '--format=%H'],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    const line = stdout.trim().split('\n').find((entry) => entry !== '')
    return line ?? null
  } catch {
    return null
  }
}
