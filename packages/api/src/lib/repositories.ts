import type { ComponentSpec, Repository, RepositorySpec } from '@ductum/core'

import { ValidationError } from './errors.js'

export interface RepositoryOnboardingInput {
  name: string
  spec: RepositorySpec
  components: Array<{ name: string; spec: ComponentSpec }>
}

export function normalizeRepositoryInput(value: unknown, field = 'repository'): RepositoryOnboardingInput {
  const raw = requireRecord(value, field)
  const spec = normalizeRepositorySpec(raw.spec ?? raw, field)
  const name = optionalString(raw.name, `${field}.name`) ?? repositoryNameFromSpec(spec)
  const components = normalizeComponentInputs(raw.components, `${field}.components`)
  return { name, spec, components }
}

export function normalizeRepositorySpec(value: unknown, field = 'spec'): RepositorySpec {
  const raw = requireRecord(value, field)
  const remoteUrl = optionalString(raw.remoteUrl, `${field}.remoteUrl`)
    ?? optionalString(raw.repo, `${field}.repo`)
  const localPath = optionalString(raw.localPath, `${field}.localPath`)
    ?? optionalString(raw.path, `${field}.path`)
  if (remoteUrl == null && localPath == null) {
    throw new ValidationError(`${field} must include remoteUrl or localPath`)
  }
  return compact({
    remoteUrl,
    localPath,
    defaultBranch: optionalString(raw.defaultBranch, `${field}.defaultBranch`),
    branchPrefix: optionalString(raw.branchPrefix, `${field}.branchPrefix`),
    authRef: optionalString(raw.authRef, `${field}.authRef`),
  }) as RepositorySpec
}

export function normalizeComponentInput(value: unknown, field = 'component'): { name: string; spec: ComponentSpec } {
  const raw = requireRecord(value, field)
  const path = optionalString(raw.path, `${field}.path`)
  const name = optionalString(raw.name, `${field}.name`) ?? path
  if (name == null) throw new ValidationError(`${field}.name is required`)
  return { name, spec: compact({ path }) as ComponentSpec }
}

export function repositoryLegacyRef(repository: Repository): string {
  return repository.spec.localPath ?? repository.spec.remoteUrl ?? repository.name
}

export function repositoryNameFromSpec(spec: RepositorySpec): string {
  const source = spec.remoteUrl ?? spec.localPath
  if (source == null) return 'repository'
  const clean = source.replace(/\.git$/i, '').replace(/\/+$/, '')
  return clean.split(/[/:\\]/).filter(Boolean).pop() ?? 'repository'
}

function normalizeComponentInputs(value: unknown, field: string): Array<{ name: string; spec: ComponentSpec }> {
  if (value == null) return []
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`)
  return value.map((entry, index) => normalizeComponentInput(entry, `${field}[${index}]`))
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
  return trimmed === '' ? undefined : trimmed
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}
