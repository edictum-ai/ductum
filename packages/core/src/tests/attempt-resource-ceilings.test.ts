import { describe, expect, it } from 'vitest'

import { applyAttemptResourceCeilings } from '../attempt-resource-ceilings.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'

describe('attempt resource ceilings', () => {
  const base: HarnessSessionResult = {
    exitReason: 'completed',
    tokensIn: 100,
    tokensOut: 10,
    costUsd: 0.01,
    turns: 1,
    maxInputTokensInTurn: 100,
  }

  it('pauses retryably when cumulative cost exceeds the cap', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, costUsd: 2.5 },
      { maxCumulativeCostUsd: 2 },
    )

    expect(hit?.ceiling).toBe('maxCumulativeCostUsd')
    expect(result.exitReason).toBe('paused-cost-budget')
    expect(result.failReason).toBe('maxCumulativeCostUsd')
    expect(result.failureEvidence?.category).toBe('policy')
  })

  it('pauses retryably when turn count exceeds the cap', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, turns: 4 },
      { maxTurns: 3 },
    )

    expect(hit?.ceiling).toBe('maxTurns')
    expect(result.exitReason).toBe('paused-max-turns')
    expect(result.pauseDetail?.detail).toContain('attempt turns 4 exceeded cap 3')
  })
})
