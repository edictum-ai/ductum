import type { AgentResourceRefs } from '@ductum/core'

import { ValidationError } from './errors.js'

const REF_FIELDS = [
  'modelRef',
  'harnessRef',
  'workflowProfileRef',
  'sandboxRef',
  'systemPromptRef',
  'toolsRef',
  'policyRef',
] as const

export function normalizeAgentResourceRefs(value: unknown, field = 'resourceRefs'): AgentResourceRefs {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`)
  }
  const raw = value as Record<string, unknown>
  const refs: AgentResourceRefs = {}
  for (const key of REF_FIELDS) {
    const ref = optionalString(raw[key], `${field}.${key}`)
    if (ref != null) refs[key] = ref
  }
  return refs
}

export function agentResourceRefsFromConfig(value: Record<string, unknown>, field: string): AgentResourceRefs {
  const refs = normalizeAgentResourceRefs(value.resourceRefs, `${field}.resourceRefs`)
  for (const key of REF_FIELDS) {
    const ref = optionalString(value[key], `${field}.${key}`)
    if (ref != null && refs[key] != null) {
      throw new ValidationError(`${field}.${key} conflicts with ${field}.resourceRefs.${key}`)
    }
    if (ref != null) refs[key] = ref
  }
  return refs
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
