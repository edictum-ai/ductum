import { describe, expect, it } from 'vitest'

import { resolveSessionCostForCeiling } from '../dispatcher-session-cost.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'
import type { Run, RunId } from '../types.js'

describe('resolveSessionCostForCeiling', () => {
  it('uses the projected run-total cost when scanner data covers the current session', () => {
    const runId = 'run-cost' as RunId
    const current = { id: runId, costUsd: 90 } as Run
    const result = { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => ({
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 0,
        costUsd: 15,
      }),
      resolveRuntimeAgentForRun: () => null,
    }, runId, current, result, null)

    expect(ceiling).toEqual({ cumulativeCostUsd: 105, source: 'scanner' })
  })

  it('uses the projected run-total cost when runtime cost covers the current session', () => {
    const runId = 'run-runtime-cost' as RunId
    const current = { id: runId, costUsd: 90 } as Run
    const result = {
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 15,
      costState: 'measured',
    } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => null,
    }, runId, current, result, null)

    expect(ceiling).toEqual({ cumulativeCostUsd: 105, source: 'runtime' })
  })
})
