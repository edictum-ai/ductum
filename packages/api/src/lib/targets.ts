import type { TargetBranch, TargetSource, TargetSourceType, TargetSpec } from '@ductum/core'

import { ValidationError } from './errors.js'

const SOURCE_TYPES = new Set<TargetSourceType>([
  'github',
  'local',
  'monorepo-package',
  'subdirectory',
  'docs-site',
  'app',
  'service',
])

export function normalizeTargetSpec(value: unknown, field = 'spec'): TargetSpec {
  const raw = requireRecord(value, field)
  const source = normalizeTargetSource(raw.source, `${field}.source`)
  const branch = normalizeTargetBranch(raw.branch, `${field}.branch`)
  const workflowRef = optionalString(raw.workflowRef, `${field}.workflowRef`)
  const authRef = optionalString(raw.authRef, `${field}.authRef`)
  return {
    source,
    ...(branch == null ? {} : { branch }),
    ...(workflowRef == null ? {} : { workflowRef }),
    ...(authRef == null ? {} : { authRef }),
  }
}

function normalizeTargetSource(value: unknown, field: string): TargetSource {
  const raw = requireRecord(value, field)
  const type = optionalString(raw.type, `${field}.type`)
  if (type == null || !SOURCE_TYPES.has(type as TargetSourceType)) {
    throw new ValidationError(`${field}.type must be one of: ${[...SOURCE_TYPES].join(', ')}`)
  }
  const source = compact({
    type: type as TargetSourceType,
    repo: optionalString(raw.repo, `${field}.repo`),
    localPath: optionalString(raw.localPath, `${field}.localPath`),
    package: optionalString(raw.package, `${field}.package`),
    subdirectory: optionalString(raw.subdirectory, `${field}.subdirectory`),
  }) as TargetSource
  if (source.type === 'github' && empty(source.repo)) {
    throw new ValidationError(`${field}.repo is required for github targets`)
  }
  if (source.type === 'local' && empty(source.localPath)) {
    throw new ValidationError(`${field}.localPath is required for local targets`)
  }
  if (empty(source.repo) && empty(source.localPath) && empty(source.package) && empty(source.subdirectory)) {
    throw new ValidationError(`${field} must identify a repo, localPath, package, or subdirectory`)
  }
  return source
}

function normalizeTargetBranch(value: unknown, field: string): TargetBranch | undefined {
  if (value == null) return undefined
  const raw = requireRecord(value, field)
  const branch = compact({
    base: optionalString(raw.base, `${field}.base`),
    prefix: optionalString(raw.prefix, `${field}.prefix`),
  }) as TargetBranch
  return Object.keys(branch).length === 0 ? undefined : branch
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : value
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function empty(value: string | undefined): boolean {
  return value == null || value.trim() === ''
}
