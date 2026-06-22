import { AgentRuntimeResolutionError } from './agent-runtime-resolution.js'
import type { ContainerSandboxSpec, SandboxBoundaryDescriptor } from './sandbox-driver.js'
import type { RunSandboxProfileSnapshot } from './types.js'

/**
 * Shared, driver-agnostic sandbox-spec parsing helpers.
 *
 * Runtime dependency surface is intentionally tiny (only
 * {@link AgentRuntimeResolutionError}) so this module can be imported by both
 * `sandbox-driver.ts` (host) and `podman-sandbox-driver.ts` (container) without
 * creating a runtime module cycle — the sandbox-driver symbols referenced here
 * are type-only and erased at runtime.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function hasNonEmptyValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.some(hasNonEmptyValue)
  if (isPlainObject(value)) return Object.values(value).some(hasNonEmptyValue)
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

export function rejectNonEmpty(profile: RunSandboxProfileSnapshot, field: string, value: unknown): void {
  if (!hasNonEmptyValue(value)) return
  throw sandboxError(profile, `does not support spec.${field}`)
}

export function sandboxError(profile: RunSandboxProfileSnapshot, reason: string): AgentRuntimeResolutionError {
  return new AgentRuntimeResolutionError(
    `SandboxProfile ${profile.name} (${profile.provider}/${profile.mode}) ${reason}`,
    'resource_malformed',
  )
}

/**
 * Parse a `container` sandbox spec. Only `provider: 'podman'` with
 * `mode: 'container'` is supported; every other container-shaped provider
 * (docker, local, ...) fails honestly with the same `unsupported sandbox
 * runtime <provider>/<mode>` message the host path uses.
 *
 * The Podman driver enforces a deliberately narrow, fully-truthful claim set
 * (see {@link podmanBoundary}). Any claim the driver cannot enforce for real is
 * rejected here as an unsupported claim, so the prepared boundary descriptor
 * never overstates isolation.
 */
export function parseContainerSandboxSpec(
  profile: RunSandboxProfileSnapshot,
  resourceSpec: unknown,
): ContainerSandboxSpec {
  if (profile.provider !== 'podman' || profile.mode !== 'container') {
    throw sandboxError(profile, `unsupported sandbox runtime ${profile.provider}/${profile.mode}`)
  }
  if (!isPlainObject(resourceSpec)) {
    throw sandboxError(profile, 'requires spec to be an object')
  }
  const image = readNonEmptyString(resourceSpec.image)
  if (image == null) {
    throw sandboxError(profile, 'requires spec.image to name a podman image')
  }
  if (image.startsWith('-')) {
    throw sandboxError(profile, 'does not support spec.image values that begin with "-"')
  }
  rejectKindIfPresent(profile, resourceSpec)
  const filesystem = parsePodmanFilesystemClaim(profile, resourceSpec.filesystem)
  const network = parsePodmanNetworkClaim(profile, resourceSpec.network)
  const credentials = parsePodmanCredentialsClaim(profile, resourceSpec.credentials)
  rejectNonEmpty(profile, 'resources', resourceSpec.resources)
  const process = parsePodmanProcessClaim(profile, resourceSpec.process)
  return {
    kind: 'container',
    provider: 'podman',
    mode: 'container',
    image,
    ...(filesystem == null ? {} : { filesystem }),
    ...(network == null ? {} : { network }),
    ...(credentials == null ? {} : { credentials }),
    ...(process == null ? {} : { process }),
  }
}

/**
 * Boundary of a prepared Podman container sandbox. Each field reflects a
 * property the driver actually establishes on the container it starts:
 *   - filesystem 'worktree-readWrite': the worktree is bind-mounted writable;
 *   - network 'container-default': Podman's default container network is used
 *     so Codex can reach the host MCP endpoint and model provider APIs;
 *   - process 'namespaced': the container runs in its own PID namespace;
 *   - credentials 'scoped': this sandbox type is paired with the scoped-secret
 *     broker (credentials are broker-resolved at dispatch, never ambient
 *     `process.env`), distinct from the host driver's ambient 'host' model;
 *   - resources 'none': cpu/memoryMb claims are rejected (not capped).
 *
 * Honesty caveat (see decisions/179): this is not an egress allowlist. It is
 * the honest network boundary for the current Codex-in-container path.
 */
export const podmanBoundary: SandboxBoundaryDescriptor = {
  filesystem: 'worktree-readWrite',
  network: 'container-default',
  credentials: 'scoped',
  resources: 'none',
  process: 'namespaced',
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function rejectKindIfPresent(profile: RunSandboxProfileSnapshot, spec: Record<string, unknown>): void {
  const kind = spec.kind
  if (kind == null) return
  if (kind !== 'container') {
    throw sandboxError(profile, `does not support spec.kind=${String(kind)}`)
  }
}

function parsePodmanFilesystemClaim(
  profile: RunSandboxProfileSnapshot,
  value: unknown,
): { worktree: 'readWrite' } | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.filesystem to be an object')
  const worktree = value.worktree
  if (worktree != null && worktree !== 'readWrite') {
    throw sandboxError(profile, `does not support filesystem.worktree=${String(worktree)}`)
  }
  rejectUnsupportedKeys(profile, 'filesystem', value, ['worktree'])
  return { worktree: 'readWrite' }
}

function parsePodmanNetworkClaim(
  profile: RunSandboxProfileSnapshot,
  value: unknown,
): { mode: 'container-default' } | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.network to be an object')
  const mode = value.mode
  if (mode != null && mode !== 'container-default') {
    throw sandboxError(profile, `does not support network.mode=${String(mode)}`)
  }
  rejectUnsupportedKeys(profile, 'network', value, ['mode'])
  return { mode: 'container-default' }
}

function parsePodmanCredentialsClaim(
  profile: RunSandboxProfileSnapshot,
  value: unknown,
): { mode: 'scoped' } | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.credentials to be an object')
  const mode = value.mode
  if (mode != null && mode !== 'scoped') {
    throw sandboxError(profile, `does not support credentials.mode=${String(mode)}`)
  }
  rejectUnsupportedKeys(profile, 'credentials', value, ['mode'])
  return { mode: 'scoped' }
}

function parsePodmanProcessClaim(
  profile: RunSandboxProfileSnapshot,
  value: unknown,
): { mode: 'namespaced' } | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.process to be an object')
  const mode = value.mode
  if (mode != null && mode !== 'namespaced') {
    throw sandboxError(profile, `does not support process.mode=${String(mode)}`)
  }
  rejectUnsupportedKeys(profile, 'process', value, ['mode'])
  return { mode: 'namespaced' }
}

function rejectUnsupportedKeys(
  profile: RunSandboxProfileSnapshot,
  field: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unsupported = Object.entries(value).find(([key, item]) => !allowed.includes(key) && hasNonEmptyValue(item))
  if (unsupported != null) {
    throw sandboxError(profile, `does not support ${field}.${unsupported[0]}`)
  }
}
