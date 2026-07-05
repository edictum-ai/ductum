import { describe, expect, it } from 'vitest'

import { readAttemptResourceCeilings } from '../lib/attempt-ceilings-env.js'

describe('attempt ceiling env parsing', () => {
  it('reads positive per-attempt ceilings', () => {
    expect(readAttemptResourceCeilings(undefined, JSON.stringify({
      maxInputTokensPerTurn: 12_000,
      maxCumulativeCostUsd: 4.5,
      maxTurns: 20,
    }))).toEqual({
      maxInputTokensPerTurn: 12_000,
      maxCumulativeCostUsd: 4.5,
      maxTurns: 20,
    })
  })

  it('falls back to Factory Settings/defaults for empty or nonpositive ceiling values', () => {
    expect(readAttemptResourceCeilings({ maxTurns: 12 }, JSON.stringify({
      maxInputTokensPerTurn: 0,
      maxCostUsd: -1,
      maxTurns: null,
    }))).toEqual({ maxTurns: 12 })
  })

  it('supports explicit env opt-out', () => {
    expect(readAttemptResourceCeilings({ maxTurns: 12 }, JSON.stringify({ enabled: false }))).toEqual({ enabled: false })
    expect(readAttemptResourceCeilings({ maxTurns: 12 }, 'off')).toEqual({ enabled: false })
  })
})
