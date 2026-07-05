import { resolveUsageCostTruth } from '@ductum/core'

import { resultTelemetry, type ActiveSession } from './codex-app-server-types.js'

export function completeDeadCodexAppServerSession(active: ActiveSession): void {
  if (active.completed) return
  active.completed = true
  const cost = resolveUsageCostTruth(active.model, active.tokensIn, active.tokensOut)
  active.resolveCompletion?.(active.failureResult ?? {
    exitReason: active.child.exitCode === 0 ? 'completed' : 'crashed',
    tokensIn: active.tokensIn,
    tokensOut: active.tokensOut,
    costUsd: cost.costUsd,
    costState: cost.state,
    ...resultTelemetry(active),
  })
}
