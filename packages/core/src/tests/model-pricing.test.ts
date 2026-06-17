import { describe, expect, it } from 'vitest'

import { CLAUDE_RATES, CODEX_RATES } from '../cost-scanner.js'
import {
  computeCacheAwareCost,
  computeCost,
  lookupPricing,
  lookupScannerRates,
  MODEL_PRICING,
} from '../model-pricing.js'

describe('lookupPricing', () => {
  it('returns a known entry by exact match', () => {
    expect(lookupPricing('claude-sonnet-4-6')).toEqual(MODEL_PRICING['claude-sonnet-4-6'])
  })

  it('matches case-insensitively', () => {
    expect(lookupPricing('Claude-Sonnet-4-6')).toEqual(MODEL_PRICING['claude-sonnet-4-6'])
  })

  it('matches date-suffixed model ids', () => {
    // Anthropic sometimes suffixes models with a date like
    // claude-sonnet-4-6-20261001. Date-suffix normalization should catch it.
    const result = lookupPricing('claude-sonnet-4-6-20261001')
    expect(result).toEqual(MODEL_PRICING['claude-sonnet-4-6'])
  })

  it('returns null for an unknown model', () => {
    expect(lookupPricing('llama-42-enormous')).toBeNull()
  })

  it('returns null for explicitly unmeasured research-preview models', () => {
    expect(lookupPricing('gpt-5.3-codex-spark')).toBeNull()
  })

  it('returns null for missing/empty model strings', () => {
    expect(lookupPricing(undefined)).toBeNull()
    expect(lookupPricing(null)).toBeNull()
    expect(lookupPricing('')).toBeNull()
  })
})

describe('computeCost', () => {
  it('computes sonnet cost at 1M in / 100k out', () => {
    // 1M * 3 / 1M = 3 + 100k * 15 / 1M = 1.5 = 4.5
    expect(computeCost('claude-sonnet-4-6', 1_000_000, 100_000)).toBeCloseTo(4.5, 6)
  })

  it('computes glm cost correctly', () => {
    // glm-5v-turbo: $1.20/M input + $4.00/M output (Z.AI list)
    // 2M * 1.20 / 1M = 2.4 + 500k * 4.00 / 1M = 2.0 = 4.4
    expect(computeCost('glm-5v-turbo', 2_000_000, 500_000)).toBeCloseTo(4.4, 6)
    expect(computeCost('glm-5-turbo', 2_000_000, 500_000)).toBeCloseTo(4.4, 6)
    // glm-5.1: $1.40/M input + $4.40/M output.
    expect(computeCost('glm-5.1', 2_000_000, 500_000)).toBeCloseTo(5.0, 6)
    // glm-5.2 uses the operator-selected GLM-5.1 pricing policy.
    expect(computeCost('glm-5.2', 2_000_000, 500_000)).toBeCloseTo(5.0, 6)
    // glm-5: $1.00/M input + $3.20/M output.
    expect(computeCost('glm-5', 2_000_000, 500_000)).toBeCloseTo(3.6, 6)
  })

  it('computes codex (gpt-5.4) cost even when the harness reports 0', () => {
    // openai/gpt-5.4 list price (OpenRouter): $2.50/M input, $15/M output.
    // Per P5: harness reports 0; cost is computed from tokens at the
    // persistence layer.
    // 500k in * 2.50 + 250k out * 15 = 1.25 + 3.75 = 5.0
    expect(computeCost('openai/gpt-5.4', 500_000, 250_000)).toBeCloseTo(5.0, 6)
  })

  it('pins OpenAI documented GPT-5.1 and GPT-5.2 rates', () => {
    // gpt-5.1: $1.25/M input, $0.125/M cached input, $10/M output.
    expect(computeCost('gpt-5.1', 2_000_000, 500_000)).toBeCloseTo(7.5, 6)
    expect(CODEX_RATES['gpt-5.1']?.cachedReadPerToken).toBe(0.125e-6)

    // gpt-5.2: $1.75/M input, $0.175/M cached input, $14/M output.
    expect(computeCost('gpt-5.2', 2_000_000, 500_000)).toBeCloseTo(10.5, 6)
    expect(CODEX_RATES['gpt-5.2']?.cachedReadPerToken).toBe(0.175e-6)
  })

  it('honors the override pricing argument over the static table', () => {
    // Per-agent subscription override (e.g. Codex Pro): $0.40 in / $1.20 out
    // 500k in * 0.40 + 250k out * 1.20 = 0.20 + 0.30 = 0.50
    expect(
      computeCost(
        'openai/gpt-5.4',
        500_000,
        250_000,
        { inputUsdPer1M: 0.40, outputUsdPer1M: 1.20 },
      ),
    ).toBeCloseTo(0.50, 6)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCost('claude-sonnet-4-6', 0, 0)).toBe(0)
  })

  it('returns 0 for an unknown model (and does not throw)', () => {
    expect(computeCost('something-bespoke', 10_000, 10_000)).toBe(0)
  })

  it('returns 0 for explicitly unmeasured models', () => {
    expect(computeCost('gpt-5.3-codex-spark', 10_000, 10_000)).toBe(0)
  })

  it('returns 0 for null/undefined model without crashing', () => {
    expect(computeCost(null, 10, 10)).toBe(0)
    expect(computeCost(undefined, 10, 10)).toBe(0)
  })
})

describe('lookupScannerRates', () => {
  it('returns CODEX_RATES for openai/gpt-5.4 (provider prefix stripped)', () => {
    expect(lookupScannerRates('openai/gpt-5.4')).toBe(CODEX_RATES['gpt-5.4'])
  })

  it('returns CLAUDE_RATES for claude-sonnet-4-6', () => {
    expect(lookupScannerRates('claude-sonnet-4-6')).toBe(CLAUDE_RATES['claude-sonnet-4-6'])
  })

  it('matches a date-suffixed model id', () => {
    expect(lookupScannerRates('claude-sonnet-4-6-20261001')).toBe(CLAUDE_RATES['claude-sonnet-4-6'])
  })

  it('returns null for unknown models', () => {
    expect(lookupScannerRates('llama-42-enormous')).toBeNull()
    expect(lookupScannerRates('gpt-5.3-codex-spark')).toBeNull()
    expect(lookupScannerRates(null)).toBeNull()
    expect(lookupScannerRates('')).toBeNull()
  })
})

describe('computeCacheAwareCost', () => {
  it('matches the scanner formula for codex (uncached + cached + output)', () => {
    // 100k gross input, 80k cached, 50k output @ gpt-5.4 rates:
    //   uncached = 20k * 2.5e-6   = 0.05
    //   cached   = 80k * 2.5e-7   = 0.02
    //   output   = 50k * 1.5e-5   = 0.75
    //   total                     = 0.82
    expect(
      computeCacheAwareCost('openai/gpt-5.4', 100_000, 50_000, 80_000, 0),
    ).toBeCloseTo(0.82, 6)
  })

  it('matches the scanner formula for claude (uncached + cache_read + cache_creation + output)', () => {
    // gross 100k = uncached 50k + cacheRead 30k + cacheCreate 20k
    // output 10k. claude-sonnet-4-6 rates:
    //   uncached = 50k * 3e-6     = 0.15
    //   cacheRead = 30k * 3e-7    = 0.009
    //   cacheCreate = 20k * 3.75e-6 = 0.075
    //   output = 10k * 1.5e-5     = 0.15
    //   total                     = 0.384
    expect(
      computeCacheAwareCost('claude-sonnet-4-6', 100_000, 10_000, 30_000, 20_000),
    ).toBeCloseTo(0.384, 6)
  })

  it('falls back to flat-rate computeCost when cached counts are 0', () => {
    // openai/gpt-5.4 list 2.5/15. 100k * 2.5e-6 = 0.25 + 50k * 1.5e-5 = 0.75 = 1.0
    expect(
      computeCacheAwareCost('openai/gpt-5.4', 100_000, 50_000, 0, 0),
    ).toBeCloseTo(1.0, 6)
  })

  it('falls back to flat-rate computeCost for unknown models even with cached counts', () => {
    // No CODEX_RATES / CLAUDE_RATES match → returns 0 (computeCost behavior).
    expect(
      computeCacheAwareCost('llama-42-enormous', 100_000, 50_000, 80_000, 0),
    ).toBe(0)
  })

  it('honors the per-agent override over the cache-aware path (subscription rate)', () => {
    // Override: $0.40/M input, $1.20/M output. Cached counts are
    // ignored — override uses gross input. 100k * 0.4e-6 = 0.04 +
    // 50k * 1.2e-6 = 0.06 = 0.10
    expect(
      computeCacheAwareCost(
        'openai/gpt-5.4',
        100_000,
        50_000,
        80_000, // cached — ignored
        0,
        { inputUsdPer1M: 0.40, outputUsdPer1M: 1.20 },
      ),
    ).toBeCloseTo(0.10, 6)
  })

  it('clamps cached > gross input so a buggy harness cannot produce negative cost', () => {
    // cachedTokensIn=200k > tokensIn=100k → clamped to 100k cached, 0 uncached.
    // 100k * cachedReadPerToken (2.5e-7) + 50k * 1.5e-5 = 0.025 + 0.75 = 0.775
    expect(
      computeCacheAwareCost('openai/gpt-5.4', 100_000, 50_000, 200_000, 0),
    ).toBeCloseTo(0.775, 6)
  })

  it('clamps negative inputs to zero', () => {
    expect(
      computeCacheAwareCost('openai/gpt-5.4', -100, -50, -10, -5),
    ).toBe(0)
  })

  it('returns 0 when both gross input and output are 0', () => {
    expect(
      computeCacheAwareCost('openai/gpt-5.4', 0, 0, 0, 0),
    ).toBe(0)
  })

  it('cache-aware codex cost is dramatically lower than the flat-rate path on cached-heavy turns', () => {
    // Reproduce the live observation: 247650/2433 with 198400 cached.
    // Flat-rate (no caching): 247650 * 2.5e-6 + 2433 * 1.5e-5 = 0.6191 + 0.0365 = 0.6556
    // Cache-aware: 49250 * 2.5e-6 + 198400 * 2.5e-7 + 2433 * 1.5e-5 = 0.1231 + 0.0496 + 0.0365 = 0.2092
    const cacheAware = computeCacheAwareCost('openai/gpt-5.4', 247650, 2433, 198400, 0)
    const flat = computeCost('openai/gpt-5.4', 247650, 2433)
    expect(cacheAware).toBeCloseTo(0.2092, 4)
    expect(flat).toBeCloseTo(0.6556, 4)
    expect(cacheAware).toBeLessThan(flat / 3) // ~3x cheaper, matches handover obs
  })
})
