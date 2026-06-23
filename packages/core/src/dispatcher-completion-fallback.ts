import { type HarnessSessionResult } from './dispatcher-support.js'
import { END_SESSION_FALLBACK_DELAY_MS } from './dispatcher-types.js'
import { log } from './logger.js'
import type { RunRepo } from './repos/interfaces.js'
import type { RunId } from './types.js'

export function scheduleCompletionFallbackForDispatcher(deps: {
  runId: RunId
  routedPostCompletion: Set<RunId>
  completionFallbacks: Map<RunId, NodeJS.Timeout>
  runRepo: RunRepo
  handledSessionEnds: Set<RunId>
  handleSessionEnd: (runId: RunId, result: HarnessSessionResult) => Promise<void>
}): void {
  if (deps.routedPostCompletion.has(deps.runId) || deps.completionFallbacks.has(deps.runId)) return
  const timer = setTimeout(() => {
    deps.completionFallbacks.delete(deps.runId)
    if (deps.routedPostCompletion.has(deps.runId)) return
    const run = deps.runRepo.get(deps.runId)
    if (run == null || run.terminalState != null || run.stage === 'done') return
    deps.handledSessionEnds.delete(deps.runId)
    log.warn('dispatcher', `completion fallback fired for ${deps.runId.slice(0, 8)} — forcing post-completion routing`)
    void deps.handleSessionEnd(deps.runId, { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
  }, END_SESSION_FALLBACK_DELAY_MS)
  deps.completionFallbacks.set(deps.runId, timer)
}

export function clearCompletionFallbackForDispatcher(
  completionFallbacks: Map<RunId, NodeJS.Timeout>,
  runId: RunId,
): void {
  const timer = completionFallbacks.get(runId)
  if (timer == null) return
  clearTimeout(timer)
  completionFallbacks.delete(runId)
}
