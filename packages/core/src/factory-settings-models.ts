import type { ConfigResource, ModelSpec } from './resource-types.js'
import {
  MODEL_REGISTRY,
  pricingStateForEntry,
  providerModelIdForEntry,
  resolveModelEntry,
  type ModelRegistryEntry,
} from './model-registry.js'
import type { FactorySettingsModel } from './factory-settings-types.js'
import { pricingFromRates } from './factory-settings-catalog-helpers.js'

export function buildFactorySettingsModels(configResources: ConfigResource[]): FactorySettingsModel[] {
  const savedModels = configResources
    .filter((resource) => resource.kind === 'Model')
    .flatMap((resource) => modelFromResource(resource))
  const seenRegistryIds = savedRegistryIds(configResources)
  const builtIns = MODEL_REGISTRY
    .filter((entry) => !seenRegistryIds.has(entry.id))
    .map((entry) => builtInModel(entry))
  return [...savedModels, ...builtIns]
}

function savedRegistryIds(configResources: ConfigResource[]): Set<string> {
  return new Set(configResources.flatMap((resource) => {
    if (resource.kind !== 'Model') return []
    const spec = resource.spec as Partial<ModelSpec>
    const registryEntry = resolveModelEntry(spec.modelId ?? '') ?? resolveModelEntry(resource.name)
    return registryEntry == null ? [] : [registryEntry.id]
  }))
}

function modelFromResource(resource: ConfigResource): FactorySettingsModel[] {
  const spec = resource.spec as Partial<ModelSpec>
  const providerModelId = spec.modelId ?? ''
  const registryEntry = resolveModelEntry(providerModelId) ?? resolveModelEntry(resource.name)
  const savedPricing = spec.pricing
  const pricing = savedPricing ?? pricingFromRates(registryEntry?.rates)
  const pricingState = savedPricing != null
    ? 'measured'
    : registryEntry == null
      ? pricing == null ? 'unmeasured' : 'measured'
      : pricingStateForEntry(registryEntry)
  return [{
    recordType: 'Model',
    id: resource.id,
    name: resource.name,
    modelId: resource.name,
    providerId: spec.provider ?? registryEntry?.provider ?? 'unknown',
    providerModelId,
    supportedEfforts: spec.supportedEfforts as FactorySettingsModel['supportedEfforts'],
    supportedOptions: spec.supportedOptions,
    supportedHarnesses: registryEntry?.supportedHarnesses,
    availability: registryEntry?.availability,
    pricing,
    pricingState,
    pricingNote: savedPricing == null ? registryEntry?.pricingNote : undefined,
    pricingSource: savedPricing == null ? 'registry' : 'saved-resource',
    rates: registryEntry?.rates,
    scannerSource: registryEntry?.scannerKind ?? spec.scannerSource,
    sourceUrl: registryEntry?.sourceUrl ?? spec.sourceUrl,
    lastVerifiedAt: registryEntry?.lastVerifiedAt ?? spec.lastVerifiedAt,
    catalogSource: registryEntry == null ? 'saved-resource' : 'live-registry',
    savedConfigState: savedConfigState(resource, registryEntry, providerModelId),
    enabled: spec.enabled ?? true,
    scope: resource.projectId == null ? 'factory' : 'project',
    projectId: resource.projectId,
    source: 'saved',
  }]
}

function builtInModel(entry: ModelRegistryEntry): FactorySettingsModel {
  return {
    recordType: 'Model',
    id: `builtin-model:${entry.id}`,
    name: entry.id,
    modelId: entry.id,
    providerId: entry.provider,
    providerModelId: providerModelIdForEntry(entry),
    supportedEfforts: entry.supportedEfforts,
    supportedHarnesses: entry.supportedHarnesses,
    availability: entry.availability,
    pricing: pricingFromRates(entry.rates),
    pricingState: pricingStateForEntry(entry),
    pricingNote: entry.pricingNote,
    pricingSource: 'registry',
    rates: entry.rates,
    scannerSource: entry.scannerKind,
    sourceUrl: entry.sourceUrl,
    lastVerifiedAt: entry.lastVerifiedAt,
    catalogSource: 'live-registry',
    savedConfigState: 'none',
    enabled: true,
    scope: 'factory',
    projectId: null,
    source: 'built-in',
  }
}

function savedConfigState(
  resource: ConfigResource,
  registryEntry: ModelRegistryEntry | null,
  providerModelId: string,
): FactorySettingsModel['savedConfigState'] {
  if (registryEntry == null) return 'resource-authored'
  const seededName = resource.name === registryEntry.id
  const seededProviderModel = providerModelId === providerModelIdForEntry(registryEntry)
  return resource.projectId == null && seededName && seededProviderModel
    ? 'seed-frozen'
    : 'resource-authored'
}
