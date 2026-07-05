import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ATTEMPT_RESOURCE_CEILINGS,
  applyAttemptResourceCeilings,
  attemptCeilingSpawnOptions,
  describeAttemptResourceCeilings,
} from '../attempt-resource-ceilings.js'
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

  it('enforces default ceilings when no configuration is present', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, maxInputTokensInTurn: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn + 1 },
      undefined,
    )

    expect(hit?.ceiling).toBe('maxInputTokensPerTurn')
    expect(result.exitReason).toBe('paused-max-turns')
    expect(describeAttemptResourceCeilings(undefined)).toMatchObject({
      enabled: true,
      source: 'default',
    })
  })

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

  it('converts first-turn prompt_overflow into a bounded retryable ceiling result', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, exitReason: 'failed', failReason: 'prompt_overflow', tokensIn: 0, turns: 0, maxInputTokensInTurn: 0 },
      undefined,
    )

    expect(hit).toMatchObject({
      ceiling: 'maxInputTokensPerTurn',
      originalExitReason: 'failed',
      nextExitReason: 'paused-max-turns',
      cap: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn,
      observed: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn + 1,
    })
    expect(result).toMatchObject({
      exitReason: 'paused-max-turns',
      failReason: 'maxInputTokensPerTurn',
      failureEvidence: expect.objectContaining({ category: 'policy', ceiling: 'maxInputTokensPerTurn' }),
    })
  })

  it('uses priced cumulative cost instead of raw harness cost for cost ceilings', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, costUsd: 0, tokensIn: 50_000, tokensOut: 10_000 },
      { maxCumulativeCostUsd: 2 },
      { cumulativeCostUsd: 2.5 },
    )

    expect(hit?.ceiling).toBe('maxCumulativeCostUsd')
    expect(hit?.observed).toBe(2.5)
    expect(result.exitReason).toBe('paused-cost-budget')
  })

  it('passes remaining cumulative cost to per-session harness budget caps', () => {
    expect(attemptCeilingSpawnOptions(
      { maxCumulativeCostUsd: 100, maxTurns: 20 },
      null,
      { cumulativeCostUsd: 90 },
    )).toEqual({ maxBudgetUsd: 10, maxTurns: 20 })

    expect(attemptCeilingSpawnOptions(
      { maxCumulativeCostUsd: 100 },
      null,
      { cumulativeCostUsd: 125 },
    )).toEqual({ maxBudgetUsd: 0, maxTurns: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxTurns })
  })
})
