import type { AgentRole, SpecStatus, TaskComplexity, TaskStatus } from '@ductum/core'

import { ValidationError } from './errors.js'
import { optionalString, optionalStringArray, requireString } from './http.js'

const SPEC_STATUSES = ['draft', 'reviewed', 'approved', 'implementing', 'done', 'failed'] as const
const TASK_STATUSES = ['pending', 'blocked', 'ready', 'active', 'done', 'failed'] as const
const TASK_COMPLEXITIES = ['simple', 'standard', 'complex'] as const
const AGENT_ROLES = ['builder', 'reviewer', 'docs', 'watcher'] as const
const DEPENDENCY_KINDS = ['hard', 'soft'] as const

export type DependencyKind = (typeof DEPENDENCY_KINDS)[number]

function checkEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid ${field}: ${value}. Must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function parseSpecStatus(value: unknown, field: string): SpecStatus {
  return checkEnum(requireString(value, field), SPEC_STATUSES, field)
}

export function optionalSpecStatus(value: unknown, field: string): SpecStatus | undefined {
  const raw = optionalString(value, field)
  return raw === undefined ? undefined : checkEnum(raw, SPEC_STATUSES, field)
}

export function parseTaskStatus(value: unknown, field: string): TaskStatus {
  return checkEnum(requireString(value, field), TASK_STATUSES, field)
}

export function optionalTaskStatus(value: unknown, field: string): TaskStatus | undefined {
  const raw = optionalString(value, field)
  return raw === undefined ? undefined : checkEnum(raw, TASK_STATUSES, field)
}

export function optionalComplexity(value: unknown, field: string): TaskComplexity | undefined {
  const raw = optionalString(value, field)
  return raw === undefined ? undefined : checkEnum(raw, TASK_COMPLEXITIES, field)
}

export function optionalRequiredRole(value: unknown, field: string): AgentRole | undefined {
  const raw = optionalString(value, field)
  return raw === undefined ? undefined : checkEnum(raw, AGENT_ROLES, field)
}

export function optionalDependencyKind(value: unknown, field: string): DependencyKind | undefined {
  const raw = optionalString(value, field)
  return raw === undefined ? undefined : checkEnum(raw, DEPENDENCY_KINDS, field)
}

export interface ImportedTask {
  name: string
  prompt: string
  repos: string[]
  requiredRole: AgentRole | null
  verification: string[]
  dependsOn: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function parseImportedTask(raw: unknown, index: number): ImportedTask {
  const field = `tasks[${index}]`
  if (!isRecord(raw)) {
    throw new ValidationError(`${field} must be an object`)
  }
  const name = requireString(raw.name, `${field}.name`)
  if (typeof raw.prompt !== 'string') {
    throw new ValidationError(`${field}.prompt must be a string`)
  }
  const prompt = raw.prompt
  const repos = optionalStringArray(raw.repos, `${field}.repos`) ?? []
  const verification = optionalStringArray(raw.verification, `${field}.verification`) ?? []
  const requiredRole = optionalRequiredRole(raw.requiredRole, `${field}.requiredRole`) ?? null
  const dependsOnRaw = raw.depends_on
  const dependsOn = dependsOnRaw === undefined
    ? []
    : optionalStringArray(dependsOnRaw, `${field}.depends_on`) ?? []
  return { name, prompt, repos, requiredRole, verification, dependsOn }
}
