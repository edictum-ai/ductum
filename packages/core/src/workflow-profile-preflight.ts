import type { WorkspacePreflightConfig, WorkspacePreflightRuntime, WorkspacePreflightDependencies, WorkspacePreflightSandbox, WorkspacePreflightWorktree } from './workspace-preflight-types.js'

/**
 * Issue #281: parse the optional `preflight:` block from a workflow
 * profile YAML. The parser is fail-closed: an unknown or malformed
 * sub-field throws so the workflow resource surfaces as invalid rather
 * than silently disabling a check. Returns `undefined` when the block
 * is absent — the dispatcher treats that as a no-op success.
 */
export function parseWorkflowProfilePreflight(value: unknown, source = 'workflow profile'): WorkspacePreflightConfig | undefined {
  if (value == null) return undefined
  const root = expectRecord(value, `${source}.preflight`)
  expectOnlyKeys(root, `${source}.preflight`, ['enabled', 'packageManager', 'runtime', 'dependencies', 'worktree', 'sandbox', 'env', 'nativeTools'])
  const enabled = optionalBoolean(root['enabled'], `${source}.preflight.enabled`)
  const packageManager = optionalString(root['packageManager'], `${source}.preflight.packageManager`)
  const runtime = parseRuntime(root['runtime'], `${source}.preflight.runtime`)
  const dependencies = parseDependencies(root['dependencies'], `${source}.preflight.dependencies`)
  const worktree = parseWorktree(root['worktree'], `${source}.preflight.worktree`)
  const sandbox = parseSandbox(root['sandbox'], `${source}.preflight.sandbox`)
  const env = optionalStringArray(root['env'], `${source}.preflight.env`)
  const nativeTools = optionalStringArray(root['nativeTools'], `${source}.preflight.nativeTools`)
  const config: WorkspacePreflightConfig = {}
  if (enabled != null) config.enabled = enabled
  if (packageManager != null) config.packageManager = packageManager
  if (runtime != null) config.runtime = runtime
  if (dependencies != null) config.dependencies = dependencies
  if (worktree != null) config.worktree = worktree
  if (sandbox != null) config.sandbox = sandbox
  if (env != null) config.env = env
  if (nativeTools != null) config.nativeTools = nativeTools
  return config
}

function parseRuntime(value: unknown, label: string): WorkspacePreflightRuntime | undefined {
  if (value == null) return undefined
  const record = expectRecord(value, label)
  expectOnlyKeys(record, label, ['name', 'minVersion'])
  return {
    name: expectString(record['name'], `${label}.name`),
    ...(optionalString(record['minVersion'], `${label}.minVersion`) == null
      ? {}
      : { minVersion: optionalString(record['minVersion'], `${label}.minVersion`)! }),
  }
}

function parseDependencies(value: unknown, label: string): WorkspacePreflightDependencies | undefined {
  if (value == null) return undefined
  const record = expectRecord(value, label)
  expectOnlyKeys(record, label, ['lockfile', 'installDir', 'packageManager'])
  const result: WorkspacePreflightDependencies = {}
  const lockfile = optionalString(record['lockfile'], `${label}.lockfile`)
  if (lockfile != null) result.lockfile = lockfile
  const installDir = optionalString(record['installDir'], `${label}.installDir`)
  if (installDir != null) result.installDir = installDir
  const packageManager = optionalString(record['packageManager'], `${label}.packageManager`)
  if (packageManager != null) result.packageManager = packageManager
  return Object.keys(result).length === 0 ? undefined : result
}

function parseWorktree(value: unknown, label: string): WorkspacePreflightWorktree | undefined {
  if (value == null) return undefined
  const record = expectRecord(value, label)
  expectOnlyKeys(record, label, ['writable', 'expect'])
  const result: WorkspacePreflightWorktree = {}
  const writable = optionalBoolean(record['writable'], `${label}.writable`)
  if (writable != null) result.writable = writable
  const expectValue = optionalString(record['expect'], `${label}.expect`)
  if (expectValue != null) {
    if (expectValue !== 'clean' && expectValue !== 'inherited' && expectValue !== 'any') {
      throw new Error(`${label}.expect must be one of clean, inherited, any`)
    }
    result.expect = expectValue
  }
  return Object.keys(result).length === 0 ? undefined : result
}

function parseSandbox(value: unknown, label: string): WorkspacePreflightSandbox | undefined {
  if (value == null) return undefined
  const record = expectRecord(value, label)
  expectOnlyKeys(record, label, ['mode'])
  const mode = optionalString(record['mode'], `${label}.mode`)
  if (mode == null) return undefined
  if (mode !== 'host' && mode !== 'container' && mode !== 'any') {
    throw new Error(`${label}.mode must be one of host, container, any`)
  }
  return { mode }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function expectOnlyKeys(record: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new Error(`${label}.${key} is not supported`)
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown, label: string): string | undefined {
  return value == null ? undefined : expectString(value, label)
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings`)
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`))
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value == null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`)
  return value
}
