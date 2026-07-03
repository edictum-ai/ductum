import { isEmptyWatcherPlaceholderRun, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, NotFoundError } from './errors.js'

export function requireRun(context: ApiContext, runId: RunId): Run {
  const run = context.repos.runs.get(runId)
  if (run == null) {
    throw new NotFoundError(`Run not found: ${runId}`)
  }
  return run
}

export function requireLatestTaskRun(context: ApiContext, run: Run, action: string): void {
  // `runs.list` is ordered by `created_at`; empty watcher placeholder children
  // are created after their parent and would otherwise always win the "latest"
  // slot, blocking operator retry/redirect on the real parent run. Skip them —
  // a placeholder without lineage is bookkeeping, not an implementation attempt.
  const latestRun = context.repos.runs
    .list(run.taskId)
    .filter((candidate) => candidate.id === run.id || !isEmptyWatcherPlaceholderRun(candidate))
    .at(-1)
  if (latestRun == null) {
    throw new NotFoundError(`Run not found: ${run.id}`)
  }
  if (latestRun.id === run.id) {
    return
  }

  throw new ConflictError(
    `Cannot ${action} run ${run.id} because task ${run.taskId} already moved to newer run ${latestRun.id}`,
    {
      taskId: run.taskId,
      latestRunId: latestRun.id,
      latestRunStage: latestRun.stage,
      latestRunTerminalState: latestRun.terminalState,
    },
  )
}
