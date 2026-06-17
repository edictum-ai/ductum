import { describe, expect, it } from 'vitest'

import {
  MODEL_REGISTRY,
  lookupPricing,
  lookupScannerRates,
  pricingStateForEntry,
  providerModelIdForEntry,
  resolveModelEntry,
} from '@ductum/core'

import {
  HARNESSES,
  MODEL_CATALOG,
  resolveCatalogEntry,
  validateCatalogModel,
} from '../lib/model-catalog.js'
import { ValidationError } from '../lib/errors.js'

/**
 * D163 §4 — the dashboard model catalog is derived from
 * `@ductum/core/model-registry`. A future PR that re-introduces a
 * parallel catalog table, or that ships a model in the catalog but
 * forgets to add it to the registry, regresses the "GPT-5.5 unmeasured"
 * class of bug. These tests pin the derivation so that drift fails CI.
 */
describe('model catalog ↔ registry parity', () => {
  it('catalog ids are exactly the registry ids (no fork, no extras)', () => {
    const catalogIds = MODEL_CATALOG.map((entry) => entry.id).sort()
    const registryIds = MODEL_REGISTRY.map((entry) => entry.id).sort()
    expect(catalogIds).toEqual(registryIds)
  })

  it('every catalog entry resolves through @ductum/core/model-registry', () => {
    for (const catalogEntry of MODEL_CATALOG) {
      const registryEntry = resolveModelEntry(catalogEntry.id)
      expect(registryEntry, `id=${catalogEntry.id}`).not.toBeNull()
      if (registryEntry!.rates == null) {
        expect(catalogEntry.pricing).toBeUndefined()
      } else {
        // Per-1M pricing must equal per-token × 1e6 — derived, not forked.
        expect(catalogEntry.pricing?.inputUsdPer1M).toBeCloseTo(
          registryEntry!.rates.inputPerToken * 1_000_000,
          10,
        )
        expect(catalogEntry.pricing?.outputUsdPer1M).toBeCloseTo(
          registryEntry!.rates.outputPerToken * 1_000_000,
          10,
        )
      }
      // Harness availability, label, aliases, provider, etc. must match
      // the registry — these are the fields the dashboard renders.
      expect(catalogEntry.label).toBe(registryEntry!.label)
      expect(catalogEntry.providerModelId).toBe(providerModelIdForEntry(registryEntry!))
      expect(catalogEntry.aliases).toEqual(registryEntry!.aliases)
      expect(catalogEntry.provider).toBe(registryEntry!.provider)
      expect(catalogEntry.availability).toBe(registryEntry!.availability)
      expect(catalogEntry.supportedHarnesses).toEqual(registryEntry!.supportedHarnesses)
      expect(catalogEntry.defaultCostTier).toBe(registryEntry!.defaultCostTier)
      expect(catalogEntry.sourceUrl).toBe(registryEntry!.sourceUrl)
      expect(catalogEntry.lastVerifiedAt).toBe(registryEntry!.lastVerifiedAt)
      expect(catalogEntry.pricingState).toBe(pricingStateForEntry(registryEntry!))
      expect(catalogEntry.pricingNote).toBe(registryEntry!.pricingNote)
    }
  })

  it('every catalog entry is explicitly measured or unmeasured and scanner-aware', () => {
    for (const catalogEntry of MODEL_CATALOG) {
      const pricing = lookupPricing(catalogEntry.id)
      if (catalogEntry.pricingState === 'unmeasured') {
        expect(pricing, `lookupPricing(${catalogEntry.id})`).toBeNull()
        expect(catalogEntry.pricingNote).toMatch(/pricing/i)
      } else {
        expect(pricing, `lookupPricing(${catalogEntry.id})`).not.toBeNull()
      }
      // Scanner kind decides whether cache-aware rates exist. Either
      // they exist, or `scannerKind: 'none'` is set; the API test
      // pins the same invariant the core registry test pins.
      const scannerRates = lookupScannerRates(catalogEntry.id)
      const registryEntry = resolveModelEntry(catalogEntry.id)!
      if (registryEntry.scannerKind === 'none' || registryEntry.rates == null) {
        expect(scannerRates).toBeNull()
      } else {
        expect(scannerRates).not.toBeNull()
      }
    }
  })

  it('unknown ids never resolve to a catalog entry — the unmeasured contract holds at the API edge', () => {
    expect(resolveCatalogEntry('gpt-5.6-experimental')).toBeNull()
    expect(resolveCatalogEntry('llama-42-enormous')).toBeNull()
    expect(() => validateCatalogModel('gpt-5.6-experimental')).toThrow(ValidationError)
  })

  it('catalog harness list is a superset of the harnesses any catalog entry references', () => {
    const declared = new Set(HARNESSES.map((h) => h.id))
    for (const entry of MODEL_CATALOG) {
      for (const harness of entry.supportedHarnesses) {
        expect(declared, `harness=${harness}`).toContain(harness)
      }
    }
  })
})
