import { describe, expect, it } from 'vitest'

import { readAttemptResourceCeilings } from '../lib/attempt-ceilings-env.js'

describe('attempt ceiling env parsing', () => {
  it('reads positive per-attempt ceilings', () => {
    expect(readAttemptResourceCeilings(JSON.stringify({
      maxInputTokensPerTurn: 12_000,
      maxCumulativeCostUsd: 4.5,
      maxTurns: 20,
    }))).toEqual({
      maxInputTokensPerTurn: 12_000,
      maxCumulativeCostUsd: 4.5,
      maxTurns: 20,
    })
  })

  it('ignores empty or nonpositive ceiling values', () => {
    expect(readAttemptResourceCeilings(JSON.stringify({
      maxInputTokensPerTurn: 0,
      maxCostUsd: -1,
      maxTurns: null,
    }))).toBeUndefined()
  })
})
