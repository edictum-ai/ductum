import { describe, expect, it } from 'vitest'

import { CLAUDE_RATES } from '../cost-scanner.js'
import {
  computeCacheAwareCost,
  computeCost,
  computeMeasuredCost,
  lookupPricing,
  lookupScannerRates,
  MODEL_PRICING,
} from '../model-pricing.js'

describe('Claude Sonnet 5 pricing', () => {
  it('resolves flat pricing from the registry', () => {
    const pricing = lookupPricing('claude-sonnet-5')!
    const expected = pricing.inputUsdPer1M + pricing.outputUsdPer1M * 0.1

    expect(pricing).toEqual(MODEL_PRICING['claude-sonnet-5'])
    expect(computeCost('claude-sonnet-5', 1_000_000, 100_000)).toBeCloseTo(expected, 6)
    expect(computeMeasuredCost('claude-sonnet-5', 1_000_000, 100_000))
      .toEqual({ measured: true, usd: expected })
  })

  it('uses Claude cache-aware scanner rates for Sonnet 5', () => {
    const rates = lookupScannerRates('claude-sonnet-5')!
    const expected = 50_000 * rates.inputPerToken
      + 30_000 * rates.cachedReadPerToken!
      + 20_000 * rates.cacheCreationPerToken!
      + 10_000 * rates.outputPerToken

    expect(rates).toBe(CLAUDE_RATES['claude-sonnet-5'])
    expect(
      computeCacheAwareCost('claude-sonnet-5', 100_000, 10_000, 30_000, 20_000),
    ).toBeCloseTo(expected, 6)
  })
})
