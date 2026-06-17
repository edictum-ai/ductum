import type { ApiContext } from '../deps.js'
import { NotFoundError } from '../errors.js'
import type { Run, RunId } from '@ductum/core'

/** Active = not done and no terminal state */
export function isActiveRun(run: Run): boolean {
  return run.stage !== 'done' && run.terminalState == null
}

export function requireRun(context: ApiContext, runId: RunId): Run {
  const run = context.repos.runs.get(runId)
  if (run == null) {
    throw new NotFoundError(`Run not found: ${runId}`)
  }
  return run
}

export function requireTask(context: ApiContext, taskId: string) {
  const task = context.repos.tasks.get(taskId as Run['taskId'])
  if (task == null) {
    throw new NotFoundError(`Task not found: ${taskId}`)
  }
  return task
}

export function recordProgress(context: ApiContext, runId: RunId, message: string) {
  return context.repos.runUpdates.create(runId, message)
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function nonBlank(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

export function isLinkedForExternalReview(
  run: Pick<Run, 'branch' | 'commitSha' | 'prUrl'>,
): boolean {
  return [run.branch, run.commitSha, run.prUrl].every((value) => value != null && value.trim() !== '')
}
