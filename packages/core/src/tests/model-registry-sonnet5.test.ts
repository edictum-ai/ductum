import { describe, expect, it } from 'vitest'

import { effectiveRatesForEntry, lookupScannerRates, resolveModelEntry } from '../index.js'

describe('Claude Sonnet 5 registry entry', () => {
  it('records source-backed Claude Agent SDK routing and intro pricing metadata', () => {
    const sonnet = resolveModelEntry('claude-sonnet-5')

    expect(sonnet).toMatchObject({
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      provider: 'anthropic',
      availability: 'subscription',
      supportedHarnesses: ['claude-agent-sdk'],
      scannerKind: 'claude',
      sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
      lastVerifiedAt: '2026-07-01',
    })
    expect(sonnet?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(sonnet?.aliases).toContain('anthropic/claude-sonnet-5')
    expect(sonnet?.note).toMatch(/August 31, 2026/)
    expect(sonnet?.note).toMatch(/September 1, 2026/)
    expect(sonnet?.rates?.inputPerToken).toBeCloseTo(3e-6, 12)
    expect(sonnet?.rates?.outputPerToken).toBeCloseTo(15e-6, 12)
    expect(sonnet?.rates?.cachedReadPerToken).toBeCloseTo(0.3e-6, 12)
    expect(sonnet?.rates?.cacheCreationPerToken).toBeCloseTo(3.75e-6, 12)
    expect(lookupScannerRates('claude-sonnet-5')).toBe(effectiveRatesForEntry(sonnet!))
  })

  it('resolves provider-prefixed and date-suffixed Sonnet 5 aliases', () => {
    expect(resolveModelEntry('anthropic/claude-sonnet-5')?.id).toBe('claude-sonnet-5')
    expect(resolveModelEntry('claude-sonnet-5-20260701')?.id).toBe('claude-sonnet-5')
  })

  it('uses intro rates only before the September 2026 cutoff', () => {
    const sonnet = resolveModelEntry('claude-sonnet-5')!
    const intro = effectiveRatesForEntry(sonnet, new Date('2026-08-31T12:00:00Z'))!
    const standard = effectiveRatesForEntry(sonnet, new Date('2026-09-01T00:00:00Z'))!

    expect(intro.inputPerToken).toBeCloseTo(2e-6, 12)
    expect(intro.outputPerToken).toBeCloseTo(10e-6, 12)
    expect(standard.inputPerToken).toBeCloseTo(3e-6, 12)
    expect(standard.outputPerToken).toBeCloseTo(15e-6, 12)
  })
})
