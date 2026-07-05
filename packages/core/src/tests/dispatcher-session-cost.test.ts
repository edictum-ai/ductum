import { describe, expect, it } from 'vitest'

import { recordSessionCost, resolveSessionCostForCeiling } from '../dispatcher-session-cost.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'
import type { RunRepo } from '../repos/interfaces.js'
import type { Agent, Run, RunId } from '../types.js'

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
        measured: true,
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

  it('prices resumed token-only sessions from the session delta', () => {
    const runId = 'run-token-delta' as RunId
    const current = { id: runId, tokensIn: 2_000_000, tokensOut: 200_000, costUsd: 90 } as Run
    const result = {
      exitReason: 'completed',
      tokensIn: 1_000_000,
      tokensOut: 100_000,
      costUsd: 0,
    } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, null)

    expect(ceiling.source).toBe('computed')
    expect(ceiling.cumulativeCostUsd).toBeCloseTo(97.5, 4)
  })

  it('falls back to priced tokens when scanner totals are unpriced', () => {
    const runId = 'run-unpriced-scanner' as RunId
    const current = { id: runId, costUsd: 2 } as Run
    const result = { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => ({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 100_000,
        costUsd: 0,
        measured: false,
      }),
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, null)

    expect(ceiling.source).toBe('computed')
    expect(ceiling.cumulativeCostUsd).toBeCloseTo(9.5, 4)
  })

  it('records unpriced scanner totals with computed cost accounting', () => {
    const runId = 'run-record-unpriced-scanner' as RunId
    const current = { id: runId, tokensIn: 20, tokensOut: 5, costUsd: 2 } as Run
    const updates: Array<[RunId, number, number, number]> = []
    const runRepo = {
      updateTokens: (id: RunId, tokensIn: number, tokensOut: number, costUsd: number) => {
        updates.push([id, tokensIn, tokensOut, costUsd])
        return current
      },
    } as unknown as RunRepo
    const result = { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 } as HarnessSessionResult

    recordSessionCost({
      runRepo,
      resolveScannerSnapshot: () => ({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 100_000,
        costUsd: 0,
        measured: false,
      }),
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, null)

    expect(updates).toHaveLength(1)
    expect(updates[0]?.[0]).toBe(runId)
    expect(updates[0]?.[1]).toBe(1_000_000)
    expect(updates[0]?.[2]).toBe(100_000)
    expect(updates[0]?.[3]).toBeCloseTo(7.5, 4)
  })
})

const pricedAgent = {
  model: 'test-priced-model',
  pricing: { inputUsdPer1M: 5, outputUsdPer1M: 25 },
} as Agent
