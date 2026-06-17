import type { Agent } from '@ductum/core'

export interface OpenCodeModelRef {
  providerID: string
  modelID: string
}

export function resolveOpenCodeModel(agent: Agent): OpenCodeModelRef | undefined {
  const env = agent.spawnConfig.env ?? {}
  const providerID = env.OPENCODE_PROVIDER_ID
  const modelID = env.OPENCODE_MODEL_ID

  if (providerID != null && modelID != null) {
    return { providerID, modelID }
  }

  const [parsedProvider, parsedModel] = agent.model.split('/', 2)
  if (parsedProvider != null && parsedModel != null) {
    return {
      providerID: parsedProvider,
      modelID: parsedModel,
    }
  }

  return undefined
}
