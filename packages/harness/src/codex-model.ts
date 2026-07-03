import { CODEX_SENDABLE_EFFORTS, type AgentEffort } from '@ductum/core'

export function normalizeCodexModel(model: string | null | undefined): string | undefined {
  if (model == null || model.trim() === '') return undefined
  return model.trim().replace(/^openai\//i, '')
}

export function normalizeCodexEffort(effort: AgentEffort | null | undefined): string | undefined {
  if (effort && (CODEX_SENDABLE_EFFORTS as readonly AgentEffort[]).includes(effort)) {
    return effort
  }
  return undefined
}
