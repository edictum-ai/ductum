import type { AgentEffort } from '@ductum/core'

export function normalizeCodexModel(model: string | null | undefined): string | undefined {
  if (model == null || model.trim() === '') return undefined
  return model.trim().replace(/^openai\//i, '')
}

export function normalizeCodexEffort(effort: AgentEffort | null | undefined): string | undefined {
  if (effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
    return effort
  }
  return undefined
}
