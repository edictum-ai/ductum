import { MODEL_REGISTRY, resolveModelEntry } from './model-registry.js'
import type { Harness } from './types.js'

export class FactorySettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FactorySettingsValidationError'
  }
}

export interface FactorySettingsAgentCompatibilityInput {
  agentName: string
  ductumModelId: string
  providerId: string
  providerModelId: string
  harnessType: string
}

export function assertFactorySettingsAgentCompatible(input: FactorySettingsAgentCompatibilityInput): void {
  const ductumModelId = requireValue(input.ductumModelId, `Agent ${input.agentName} Ductum model ID`)
  const providerId = requireValue(input.providerId, `Agent ${input.agentName} provider ID`)
  const providerModelId = requireValue(input.providerModelId, `Agent ${input.agentName} provider model ID`)
  const harnessType = requireValue(input.harnessType, `Agent ${input.agentName} Harness adapter type`)
  const registryEntry = resolveModelEntry(providerModelId)
  // Copilot is the routing provider; its SDK exposes upstream model ids such as gpt-5.4.
  if (providerId === 'github-copilot' && harnessType === 'copilot-sdk') return
  if (registryEntry != null && registryEntry.provider !== providerId) {
    throw new FactorySettingsValidationError(
      `Agent ${input.agentName} Ductum model ID ${ductumModelId} provider ID ${providerId} does not match provider model ID ${providerModelId} (${registryEntry.provider})`,
    )
  }

  if (!isKnownHarnessType(harnessType)) return

  if (registryEntry != null) {
    if (!registryEntry.supportedHarnesses.includes(harnessType)) {
      throw new FactorySettingsValidationError(
        `Agent ${input.agentName} Ductum model ID ${ductumModelId} with provider model ID ${providerModelId} is not supported by Harness adapter type ${harnessType}`,
      )
    }
    return
  }

  const supportedHarnesses = supportedHarnessesForProvider(providerId)
  if (supportedHarnesses.length > 0 && !supportedHarnesses.includes(harnessType)) {
    throw new FactorySettingsValidationError(
      `Agent ${input.agentName} Ductum model ID ${ductumModelId} with provider model ID ${providerModelId} is not supported by Harness adapter type ${harnessType}`,
    )
  }
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new FactorySettingsValidationError(`${label} is required`)
  return trimmed
}

function supportedHarnessesForProvider(providerId: string): string[] {
  const supported = new Set<string>()
  for (const entry of MODEL_REGISTRY) {
    if (entry.provider !== providerId) continue
    for (const harness of entry.supportedHarnesses) supported.add(harness)
  }
  return [...supported]
}

function isKnownHarnessType(harnessType: string): harnessType is Harness {
  return MODEL_REGISTRY.some((entry) => entry.supportedHarnesses.includes(harnessType as Harness))
}
