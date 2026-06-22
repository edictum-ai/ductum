import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { ExtensionRegistry, type ExtensionKind, type ExtensionManifest, type ExtensionRegistration } from './extension-registry.js'

const MANIFEST_FILE = 'ductum-extension.json'
const SCHEMA_VERSION = 'ductum.extension.v1'
const VALID_KINDS = new Set<ExtensionKind>(['harness', 'provider', 'sandbox', 'stage', 'notifier'])
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

export interface AllowlistedExtensionRegistration extends ExtensionRegistration {
  manifest: ExtensionManifest & {
    schemaVersion: typeof SCHEMA_VERSION
    source: 'operator-allowlisted'
    entrypoint: string
  }
  manifestPath: string
  entrypointPath: string
}

export interface LoadAllowlistedExtensionManifestsOptions {
  paths: readonly string[]
  registry?: ExtensionRegistry
}

export function loadAllowlistedExtensionManifests(
  options: LoadAllowlistedExtensionManifestsOptions,
): AllowlistedExtensionRegistration[] {
  const registry = options.registry ?? new ExtensionRegistry()
  const loaded: AllowlistedExtensionRegistration[] = []
  for (const inputPath of options.paths) {
    const registration = readAllowlistedExtensionManifest(inputPath)
    registry.register(registration)
    loaded.push(registration)
  }
  return loaded
}

export function readAllowlistedExtensionManifest(inputPath: string): AllowlistedExtensionRegistration {
  const manifestPath = resolveManifestPath(inputPath)
  const value = readJsonObject(manifestPath)
  const id = readString(value, 'id', manifestPath)
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid extension manifest ${manifestPath}: id must match ${ID_PATTERN.source}`)
  }
  const kind = readString(value, 'kind', manifestPath)
  if (!VALID_KINDS.has(kind as ExtensionKind)) {
    throw new Error(`Invalid extension manifest ${manifestPath}: kind must be one of ${[...VALID_KINDS].join(', ')}`)
  }
  const schemaVersion = readString(value, 'schemaVersion', manifestPath)
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Invalid extension manifest ${manifestPath}: schemaVersion must be ${SCHEMA_VERSION}`)
  }
  const capabilities = readStringArray(value, 'capabilities', manifestPath)
  if (capabilities.length === 0) {
    throw new Error(`Invalid extension manifest ${manifestPath}: capabilities must contain at least one value`)
  }
  const entrypoint = readString(value, 'entrypoint', manifestPath)
  const entrypointPath = resolveEntrypoint(manifestPath, entrypoint)
  return {
    manifest: {
      schemaVersion,
      id,
      kind: kind as ExtensionKind,
      source: 'operator-allowlisted',
      capabilities,
      entrypoint,
    },
    manifestPath,
    entrypointPath,
    loadMessage: `Extension: ${id} (${kind}) manifest loaded from ${manifestPath}`,
  }
}

function resolveManifestPath(inputPath: string): string {
  const resolved = resolve(inputPath)
  if (!existsSync(resolved)) {
    throw new Error(`Extension manifest path does not exist: ${resolved}`)
  }
  const manifestPath = statSync(resolved).isDirectory() ? join(resolved, MANIFEST_FILE) : resolved
  if (!existsSync(manifestPath)) {
    throw new Error(`Extension manifest path does not exist: ${manifestPath}`)
  }
  return manifestPath
}

function resolveEntrypoint(manifestPath: string, entrypoint: string): string {
  if (entrypoint.includes('\0') || entrypoint.startsWith('-') || isAbsolute(entrypoint)) {
    throw new Error(`Invalid extension manifest ${manifestPath}: entrypoint must be a safe relative path`)
  }
  const baseDir = dirname(manifestPath)
  const resolved = resolve(baseDir, entrypoint)
  const rel = relative(baseDir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Invalid extension manifest ${manifestPath}: entrypoint must stay inside the extension directory`)
  }
  if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
    throw new Error(`Invalid extension manifest ${manifestPath}: entrypoint does not exist: ${resolved}`)
  }
  return resolved
}

function readJsonObject(path: string): Record<string, unknown> {
  const text = readFileSync(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid extension manifest ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Invalid extension manifest ${path}: expected a JSON object`)
  }
  return value as Record<string, unknown>
}

function readString(value: Record<string, unknown>, field: string, manifestPath: string): string {
  const raw = value[field]
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Invalid extension manifest ${manifestPath}: ${field} must be a non-empty string`)
  }
  return raw
}

function readStringArray(value: Record<string, unknown>, field: string, manifestPath: string): string[] {
  const raw = value[field]
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Invalid extension manifest ${manifestPath}: ${field} must be an array of non-empty strings`)
  }
  return raw
}
