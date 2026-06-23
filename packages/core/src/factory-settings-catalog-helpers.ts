import { parseFactorySecretRef } from './factory-secret-refs.js'
import { MODEL_REGISTRY } from './model-registry.js'
import type { FactorySettingsHarness, FactorySettingsModel } from './factory-settings-types.js'

export function pricingFromRates(rates: { inputPerToken: number; outputPerToken: number } | undefined) {
  return rates == null ? undefined : {
    inputUsdPer1M: rates.inputPerToken * 1_000_000,
    outputUsdPer1M: rates.outputPerToken * 1_000_000,
  }
}

export function supportedProvidersForHarness(adapterType: string): string[] {
  const providers = new Set<string>()
  for (const entry of MODEL_REGISTRY) {
    if (entry.supportedHarnesses.includes(adapterType as never)) providers.add(entry.provider)
  }
  return [...providers].sort()
}

export function findModel(
  models: FactorySettingsModel[],
  ref: string | undefined,
  providerModelId: string,
) {
  const explicitRef = ref?.trim()
  if (explicitRef != null && explicitRef !== '') {
    const explicit = models.find((item) => item.id === explicitRef || item.name === explicitRef || item.modelId === explicitRef)
    if (explicit != null) return explicit
  }
  return models.find((item) => item.name === providerModelId || item.modelId === providerModelId)
    ?? models.find((item) => item.providerModelId === providerModelId)
}

export function findHarness(
  harnesses: FactorySettingsHarness[],
  ref: string | undefined,
  adapterType: string,
) {
  return harnesses.find((item) =>
    item.id === ref || item.name === ref || item.harnessId === ref || item.adapterType === adapterType,
  )
}

export function collectSecretRefs(value: unknown, refs = new Set<string>()): string[] {
  if (typeof value === 'string') {
    const id = parseFactorySecretRef(value)
    if (id != null) refs.add(`secret:${id}`)
  } else if (Array.isArray(value)) {
    for (const item of value) collectSecretRefs(item, refs)
  } else if (value != null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectSecretRefs(item, refs)
  }
  return [...refs].sort()
}
