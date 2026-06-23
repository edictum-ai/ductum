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

/**
 * Look for a merge commit on `base` whose subject mentions the run id
 * prefix. mergeApprovedRun writes the message as `Merge <branch> (run
 * <id8>)\n\n...` so we grep for the parenthesized run id.
 */
export async function findMergeCommitForRun(
  cwd: string,
  base: string,
  runId: RunId,
): Promise<string | null> {
  const idPrefix = runId.slice(0, 8)
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
