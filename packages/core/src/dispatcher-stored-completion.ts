import { routeCompletedRun } from './dispatcher-route-completion.js'
import type { PostCompletionRouter } from './post-completion-router.js'
import type { TaskRepo, RunRepo } from './repos/interfaces.js'
import type { RunId } from './types.js'

export async function routeStoredCompletionForDispatcher(deps: {
  runId: RunId
  runRepo: RunRepo
  taskRepo: TaskRepo
  router: PostCompletionRouter
  routedPostCompletion: Set<RunId>
  handledSessionEnds: Set<RunId>
  finishingRuns: Set<RunId>
  requestFollowUpCycle: (reason: string) => void
}): Promise<void> {
  if (deps.routedPostCompletion.has(deps.runId) || deps.finishingRuns.has(deps.runId)) return
  const run = deps.runRepo.get(deps.runId)
  if (run == null || run.terminalState != null || run.stage === 'done') return
  deps.finishingRuns.add(deps.runId)
  let routed = false
  try {
    await routeCompletedRun({ run, taskRepo: deps.taskRepo, router: deps.router })
    deps.routedPostCompletion.add(deps.runId)
    deps.handledSessionEnds.add(deps.runId)
    routed = true
  } finally {
    deps.finishingRuns.delete(deps.runId)
  }
  if (routed) deps.requestFollowUpCycle(`stored completion ${deps.runId.slice(0, 8)}`)
}
