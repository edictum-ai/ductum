import { describe, expect, it } from 'vitest'

import { recordSessionCost, resolveSessionCostForCeiling } from '../dispatcher-session-cost.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
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

  it('does not double-count runtime totals already applied by live token updates', () => {
    const runId = 'run-live-runtime-already-recorded' as RunId
    const current = { id: runId, tokensIn: 3_000_000, tokensOut: 300_000, costUsd: 97.5 } as Run
    const active = activeWithBaseline({ tokensIn: 2_000_000, tokensOut: 200_000, costUsd: 90 })
    const updates: Array<[RunId, number, number, number]> = []
    const runRepo = {
      updateTokens: (id: RunId, tokensIn: number, tokensOut: number, costUsd: number) => {
        updates.push([id, tokensIn, tokensOut, costUsd])
        return current
      },
    } as unknown as RunRepo
    const result = {
      exitReason: 'completed',
      tokensIn: 1_000_000,
      tokensOut: 100_000,
      costUsd: 0,
    } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)
    recordSessionCost({
      runRepo,
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)

    expect(ceiling.cumulativeCostUsd).toBeCloseTo(97.5, 4)
    expect(updates).toEqual([])
  })

  it('records missing computed cost when live token updates stored zero-cost tokens', () => {
    const runId = 'run-live-token-zero-cost' as RunId
    const current = { id: runId, tokensIn: 1_000_000, tokensOut: 100_000, costUsd: 0 } as Run
    const active = activeWithBaseline({ tokensIn: 0, tokensOut: 0, costUsd: 0 })
    const updates: Array<[RunId, number, number, number]> = []
    const runRepo = {
      updateTokens: (id: RunId, tokensIn: number, tokensOut: number, costUsd: number) => {
        updates.push([id, tokensIn, tokensOut, costUsd])
        return current
      },
    } as unknown as RunRepo
    const result = {
      exitReason: 'completed',
      tokensIn: 1_000_000,
      tokensOut: 100_000,
      costUsd: 0,
    } as HarnessSessionResult

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)
    recordSessionCost({
      runRepo,
      resolveScannerSnapshot: () => null,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)

    expect(ceiling.source).toBe('computed')
    expect(ceiling.cumulativeCostUsd).toBeCloseTo(7.5, 4)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual([runId, 0, 0, expect.any(Number)])
    expect(updates[0]?.[3]).toBeCloseTo(7.5, 4)
  })

  it('does not double-count scanner snapshots already applied by live scanner updates', () => {
    const runId = 'run-live-scanner-already-recorded' as RunId
    const current = { id: runId, tokensIn: 1_000_000, tokensOut: 100_000, costUsd: 5 } as Run
    const active = activeWithBaseline({ tokensIn: 0, tokensOut: 0, costUsd: 0 })
    const updates: Array<[RunId, number, number, number]> = []
    const runRepo = {
      updateTokens: (id: RunId, tokensIn: number, tokensOut: number, costUsd: number) => {
        updates.push([id, tokensIn, tokensOut, costUsd])
        return current
      },
    } as unknown as RunRepo
    const result = { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 } as HarnessSessionResult
    const scannerSnapshot = {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 100_000,
      costUsd: 5,
      measured: true,
    }

    const ceiling = resolveSessionCostForCeiling({
      resolveScannerSnapshot: () => scannerSnapshot,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)
    recordSessionCost({
      runRepo,
      resolveScannerSnapshot: () => scannerSnapshot,
      resolveRuntimeAgentForRun: () => pricedAgent,
    }, runId, current, result, active)

    expect(ceiling).toEqual({ cumulativeCostUsd: 5, source: 'scanner' })
    expect(updates).toEqual([])
  })
})

const pricedAgent = {
  model: 'test-priced-model',
  pricing: { inputUsdPer1M: 5, outputUsdPer1M: 25 },
} as Agent

function activeWithBaseline(baseline: { tokensIn: number; tokensOut: number; costUsd: number }): ActiveDispatchSession {
  return {
    initialTokensIn: baseline.tokensIn,
    initialTokensOut: baseline.tokensOut,
    initialCostUsd: baseline.costUsd,
    agent: pricedAgent,
  } as ActiveDispatchSession
}
