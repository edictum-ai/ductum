import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ATTEMPT_RESOURCE_CEILINGS,
  applyAttemptResourceCeilings,
  attemptCeilingSpawnOptions,
  defaultMaxInputTokensPerTurnForModel,
  describeAttemptResourceCeilings,
  effectiveAttemptCeilingsForTask,
  modelPromptRejectionThresholdTokens,
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

  it('converts Claude first-turn prompt_overflow with assistant usage into a bounded retryable ceiling result', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      {
        ...base,
        exitReason: 'failed',
        failReason: 'prompt_overflow',
        tokensIn: 1_000,
        turns: 1,
        maxInputTokensInTurn: 1_000,
        failureEvidence: {
          kind: 'claude-agent-sdk.prompt_overflow',
          reason: 'prompt_overflow',
          resultTextEmpty: true,
          source: 'activity',
        },
      },
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

  it('converts mid-run provider prompt_overflow into a bounded retryable ceiling result', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      {
        ...base,
        exitReason: 'failed',
        failReason: 'prompt_overflow',
        tokensIn: 9_760_000,
        tokensOut: 120_000,
        costUsd: 3.76,
        turns: 37,
        maxInputTokensInTurn: 205_000,
        failureEvidence: {
          kind: 'claude-agent-sdk.prompt_overflow',
          signature: 'Prompt is too long',
          source: 'error',
        },
      },
      undefined,
      { model: 'claude-sonnet-5' },
    )

    expect(hit).toMatchObject({
      ceiling: 'maxInputTokensPerTurn',
      observed: 205_000,
      cap: defaultMaxInputTokensPerTurnForModel('claude-sonnet-5'),
      observedTelemetry: {
        tokensIn: 9_760_000,
        tokensOut: 120_000,
        costUsd: 3.76,
        turns: 37,
        maxInputTokensInTurn: 205_000,
        failReason: 'prompt_overflow',
      },
    })
    expect(result).toMatchObject({
      exitReason: 'paused-max-turns',
      failReason: 'maxInputTokensPerTurn',
      failureEvidence: expect.objectContaining({ category: 'policy', ceiling: 'maxInputTokensPerTurn' }),
    })
  })

  it('does not apply per-turn token caps to cumulative-only successful telemetry', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, tokensIn: 200_000, maxInputTokensInTurn: undefined },
      undefined,
      { model: 'claude-sonnet-5' },
    )

    expect(hit).toBeNull()
    expect(result.exitReason).toBe('completed')
  })

  it('does not apply per-turn caps to codex app-server cumulative turn telemetry', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      { ...base, tokensIn: 500_000, maxInputTokensInTurn: 500_000, turns: 3 },
      { maxInputTokensPerTurn: 10_000 },
      { harness: 'codex-app-server' },
    )

    expect(hit).toBeNull()
    expect(result.exitReason).toBe('completed')
  })

  it('detects nested provider prompt_overflow evidence', () => {
    const { result, hit } = applyAttemptResourceCeilings(
      {
        ...base,
        exitReason: 'failed',
        failReason: 'codex app-server error: provider rejected request',
        tokensIn: 200_000,
        maxInputTokensInTurn: undefined,
        failureEvidence: { detail: { message: 'Prompt is too long' } },
      },
      undefined,
      { model: 'claude-sonnet-5' },
    )

    expect(hit).toMatchObject({
      ceiling: 'maxInputTokensPerTurn',
      observed: 180_001,
      cap: 180_000,
      observedTelemetry: {
        tokensIn: 200_000,
        maxInputTokensInTurn: null,
        failReason: 'codex app-server error: provider rejected request',
      },
    })
    expect(result.exitReason).toBe('paused-max-turns')
  })

  it('derives per-model default input caps below provider rejection thresholds', () => {
    const sonnetThreshold = modelPromptRejectionThresholdTokens('claude-sonnet-5')
    const glmThreshold = modelPromptRejectionThresholdTokens('glm-5.2')

    expect(sonnetThreshold).toBe(200_000)
    expect(glmThreshold).toBe(1_000_000)
    expect(defaultMaxInputTokensPerTurnForModel('claude-sonnet-5')).toBeLessThan(sonnetThreshold!)
    expect(defaultMaxInputTokensPerTurnForModel('glm-5.2')).toBeLessThan(glmThreshold!)
    expect(effectiveAttemptCeilingsForTask(undefined, null, { model: 'claude-sonnet-5' }).maxInputTokensPerTurn).toBe(180_000)
    expect(effectiveAttemptCeilingsForTask(undefined, null, { model: 'glm-5.2' }).maxInputTokensPerTurn).toBe(900_000)
  })

  it('uses the global input-token fallback only for unknown models', () => {
    expect(modelPromptRejectionThresholdTokens('unknown-model')).toBeNull()
    expect(defaultMaxInputTokensPerTurnForModel('unknown-model')).toBe(DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn)
    expect(effectiveAttemptCeilingsForTask(undefined, null, { model: 'unknown-model' }).maxInputTokensPerTurn).toBe(DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn)
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
    )).toEqual({ maxBudgetUsd: 10, maxTurns: 20, maxInputTokensPerTurn: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn })

    expect(attemptCeilingSpawnOptions(
      { maxCumulativeCostUsd: 100 },
      null,
      { cumulativeCostUsd: 125 },
    )).toEqual({
      maxBudgetUsd: 0,
      maxTurns: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxTurns,
      maxInputTokensPerTurn: DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn,
    })
  })
})
