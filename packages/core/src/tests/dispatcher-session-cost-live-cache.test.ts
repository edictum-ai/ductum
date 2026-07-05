import { describe, expect, it } from 'vitest'

import { recordSessionCost, resolveSessionCostForCeiling } from '../dispatcher-session-cost.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
import type { RunRepo } from '../repos/interfaces.js'
import type { Agent, Run, RunId } from '../types.js'

describe('dispatcher session cost live cache accounting', () => {
  it('preserves cache-aware live cost when final runtime result reports zero cost', () => {
    const runId = 'run-live-cache-aware-cost' as RunId
    const cacheAwareCostUsd = 0.2092
    const current = { id: runId, tokensIn: 247_650, tokensOut: 2_433, costUsd: cacheAwareCostUsd } as Run
    const agent = { model: 'openai/gpt-5.4' } as Agent
    const active = {
      initialTokensIn: 0,
      initialTokensOut: 0,
      initialCostUsd: 0,
      agent,
    } as ActiveDispatchSession
    const updates: Array<[RunId, number, number, number]> = []
    const runRepo = {
      updateTokens: (id: RunId, tokensIn: number, tokensOut: number, costUsd: number) => {
        updates.push([id, tokensIn, tokensOut, costUsd])
        return current
      },
    } as unknown as RunRepo
    const result = {
      exitReason: 'completed',
      tokensIn: 247_650,
      tokensOut: 2_433,
      costUsd: 0,
    } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => agent,
    }, runId, current, result, active)
    recordSessionCost({
      runRepo,
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => agent,
    }, runId, current, result, active)

    expect(ceiling).toEqual({ cumulativeCostUsd: cacheAwareCostUsd, source: 'none' })
    expect(updates).toEqual([])
  })
})
