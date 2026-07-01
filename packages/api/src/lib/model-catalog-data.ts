import {
  MODEL_REGISTRY,
  effectiveRatesForEntry,
  pricingStateForEntry,
  providerModelIdForEntry,
  type Harness,
  type ModelAvailability as RegistryModelAvailability,
  type ModelProvider as RegistryModelProvider,
  type ModelRegistryEntry,
} from '@ductum/core'

import type { ModelCatalogEntry } from './model-catalog.js'

export const HARNESSES: Array<{ id: Harness; label: string }> = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK' },
  { id: 'codex-sdk', label: 'Codex SDK' },
  { id: 'codex-app-server', label: 'Codex app-server' },
]

/**
 * The dashboard model catalog is derived from `@ductum/core`'s
 * registry (D163). Per-1M pricing comes from the registry's per-token
 * rates so the catalog cannot disagree with the scanner about whether
 * a model is measured.
 */
function entryToCatalog(entry: ModelRegistryEntry): ModelCatalogEntry {
  const rates = effectiveRatesForEntry(entry)
  const catalogEntry: ModelCatalogEntry = {
    id: entry.id,
    label: entry.label,
    providerModelId: providerModelIdForEntry(entry),
    provider: entry.provider as RegistryModelProvider,
    availability: entry.availability as RegistryModelAvailability,
    supportedHarnesses: entry.supportedHarnesses,
    defaultCostTier: entry.defaultCostTier,
    aliases: entry.aliases,
    sourceUrl: entry.sourceUrl,
    lastVerifiedAt: entry.lastVerifiedAt,
    note: entry.note ?? '',
    pricingState: pricingStateForEntry(entry),
  }
  if (rates != null) {
    catalogEntry.pricing = {
      inputUsdPer1M: rates.inputPerToken * 1_000_000,
      outputUsdPer1M: rates.outputPerToken * 1_000_000,
    }
  }
  if (entry.pricingNote != null) catalogEntry.pricingNote = entry.pricingNote
  if (entry.supportedEfforts != null) {
    catalogEntry.supportedEfforts = entry.supportedEfforts
  }
  return catalogEntry
}

export function buildModelCatalog(): ModelCatalogEntry[] {
  return MODEL_REGISTRY.map(entryToCatalog)
}
