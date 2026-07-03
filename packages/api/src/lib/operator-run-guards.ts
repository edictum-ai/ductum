import { isEmptyWatcherPlaceholderRun, isInvalidDoneWatcherBookkeepingRun, type Run, type RunId } from '@ductum/core'

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
  // `runs.list` is ordered by `created_at`; watcher bookkeeping children are
  // created after their parent and would otherwise always win the "latest"
  // slot, blocking operator retry/redirect on the real parent run. Skip both
  // cancelled placeholders (`stage: 'understand'`) and historical invalid
  // `done` rows that an older `BaseWatcher.stop()` path marked done without
  // lineage — neither is real implementation work. A real newer run with
  // session/worktree/completed-stage lineage still blocks stale actions.
  const latestRun = context.repos.runs
    .list(run.taskId)
    .filter((candidate) => {
      if (candidate.id === run.id) {
        return true
      }
      return !isEmptyWatcherPlaceholderRun(candidate) && !isInvalidDoneWatcherBookkeepingRun(candidate)
    })
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
