import { computeCost } from './model-pricing.js'
import type { HarnessSessionResult } from './dispatcher-support.js'
import type { ActiveDispatchSession } from './dispatcher-types.js'
import type { RunRepo } from './repos/interfaces.js'
import type { FencingToken } from './attempt-lease.js'
import type { Agent, Run, RunId } from './types.js'

/** Provider-side absolute usage snapshot from the local cost scanner. */
export interface SessionCostSnapshot {
  inputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  outputTokens: number
  costUsd: number
}

export interface RecordSessionCostDeps {
  runRepo: RunRepo
  resolveScannerSnapshot: (runId: RunId) => SessionCostSnapshot | null
  resolveRuntimeAgentForRun: (run: Run) => Agent | null
}

/**
 * Record a run's session cost. Prefers the local cost scanner's absolute
 * snapshot (Codex/Claude session logs); otherwise computes the delta from
 * the harness-reported token totals against the agent's pricing.
 *
 * Extracted from DispatcherSession to keep that file within the file-size
 * budget; behavior is unchanged.
 */
export function recordSessionCost(
  deps: RecordSessionCostDeps,
  runId: RunId,
  current: Run,
  result: HarnessSessionResult,
  active: ActiveDispatchSession | null,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): void {
  const scannerSnapshot = deps.resolveScannerSnapshot(runId)
  if (scannerSnapshot != null) {
    const tokensIn = scannerSnapshot.inputTokens + scannerSnapshot.cachedInputTokens + scannerSnapshot.cacheCreationInputTokens
    if (fenceToken != null && deps.runRepo.setTokensFenced != null) {
      deps.runRepo.setTokensFenced(runId, tokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd, fenceToken, fenceNow)
    } else {
      deps.runRepo.setTokens(runId, tokensIn, scannerSnapshot.outputTokens, scannerSnapshot.costUsd)
    }
    return
  }
  const tokensIn = Math.max(0, result.tokensIn - current.tokensIn)
  const tokensOut = Math.max(0, result.tokensOut - current.tokensOut)
  if (tokensIn <= 0 && tokensOut <= 0) return
  const agent = active?.agent ?? deps.resolveRuntimeAgentForRun(current)
  const costUsd = computeCost(agent?.model ?? null, tokensIn, tokensOut, agent?.pricing ?? undefined)
  if (fenceToken != null && deps.runRepo.updateTokensFenced != null) {
    deps.runRepo.updateTokensFenced(runId, tokensIn, tokensOut, costUsd, fenceToken, fenceNow)
  } else {
    deps.runRepo.updateTokens(runId, tokensIn, tokensOut, costUsd)
  }
}
