import type { AgentEffort, Harness, ModelAvailability, ModelPricingState, ModelProvider } from '@ductum/core'
import { isAgentEffort } from '@ductum/core'

import { HARNESSES, buildModelCatalog } from './model-catalog-data.js'
import { ValidationError } from './errors.js'

export { HARNESSES } from './model-catalog-data.js'

export type { ModelAvailability, ModelPricingState, ModelProvider } from '@ductum/core'

export interface ModelCatalogEntry {
  id: string
  label: string
  providerModelId: string
  provider: ModelProvider
  availability: ModelAvailability
  supportedHarnesses: Harness[]
  defaultCostTier: number
  aliases: string[]
  sourceUrl: string
  lastVerifiedAt: string
  note: string
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number }
  pricingState: ModelPricingState
  pricingNote?: string
  supportedEfforts?: AgentEffort[]
}

export function listModelCatalog(): ModelCatalogEntry[] {
  return buildModelCatalog()
}

export function validateHarness(value: string): Harness {
  const match = HARNESSES.find((h) => h.id === value)
  if (match == null) {
    throw new ValidationError(`Unsupported harness: ${value}`, { supported: HARNESSES.map((h) => h.id) })
  }
  return match.id
}

export function resolveCatalogEntry(model: string): ModelCatalogEntry | null {
  const key = normalizeModelId(model)
  return listModelCatalog().find((entry) => {
    if (normalizeModelId(entry.id) === key) return true
    return entry.aliases.some((alias) => normalizeModelId(alias) === key)
  }) ?? null
}

export function normalizeCatalogModel(model: string): string {
  return resolveCatalogEntry(model)?.id ?? model.trim()
}

export function validateCatalogModel(model: string): ModelCatalogEntry {
  const entry = resolveCatalogEntry(model)
  if (entry == null) {
    throw new ValidationError(`Unsupported model: ${model}`, {
      supportedModels: listModelCatalog().map((item) => item.id),
    })
  }
  return entry
}

export function validateModelForHarness(model: string, harness: Harness): ModelCatalogEntry {
  const entry = validateCatalogModel(model)
  if (!entry.supportedHarnesses.includes(harness)) {
    throw new ValidationError(`Model ${entry.id} is not supported by harness ${harness}`, {
      model: entry.id,
      harness,
      supportedHarnesses: entry.supportedHarnesses,
    })
  }
  return entry
}

export function validateEffortForModel(
  effort: string | null | undefined,
  model: string,
): AgentEffort | null {
  if (effort == null || effort === '') return null
  const entry = resolveCatalogEntry(model)
  const allowed = entry?.supportedEfforts ?? []
  if (!isAgentEffort(effort) || !allowed.includes(effort)) {
    throw new ValidationError(`Effort ${effort} is not supported by model ${model}`, {
      model,
      supportedEfforts: allowed,
    })
  }
  return effort
}

export function defaultCostTierFor(model: string): number {
  return resolveCatalogEntry(model)?.defaultCostTier ?? 50
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replaceAll('.', '-')
}
