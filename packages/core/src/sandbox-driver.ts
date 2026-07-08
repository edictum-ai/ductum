import { existsSync } from 'node:fs'

import {
  hasNonEmptyValue,
  isPlainObject,
  parseContainerSandboxSpec,
  rejectNonEmpty,
  sandboxError,
} from './sandbox-spec-helpers.js'
import type { RunId, RunSandboxProfileSnapshot } from './types.js'
import type { WorktreeManager } from './worktree.js'

type WorktreeRuntimeManager = Pick<WorktreeManager, 'enabled' | 'isGitRepo' | 'create' | 'remove'>

export interface HostSandboxFilesystemSpec {
  worktree?: 'readWrite'
}

export interface HostSandboxNetworkSpec {
  mode?: 'host'
}

export type EmptySandboxClaim = Record<string, never>

export interface HostSandboxSpec {
  kind: 'host'
  provider: 'host'
  mode: 'worktree'
  filesystem?: HostSandboxFilesystemSpec
  network?: HostSandboxNetworkSpec
  credentials?: EmptySandboxClaim
  resources?: EmptySandboxClaim
  process?: EmptySandboxClaim
}

export interface ContainerSandboxSpec {
  kind: 'container'
  provider: 'docker' | 'podman'
  mode: 'container'
  image?: string
  filesystem?: {
    worktree?: 'readWrite' | 'readOnly'
  }
  network?: {
    mode?: 'egress-allowlist' | 'none' | 'container-default'
    allowlist?: string[]
  }
  credentials?: {
    mode?: 'scoped'
  }
  resources?: {
    cpu?: number
    memoryMb?: number
  }
  process?: {
    mode?: 'namespaced'
    user?: string
  }
}

export interface RemoteSandboxSpec {
  kind: 'remote'
  provider: string
  mode: 'remote'
  endpointRef: string
  filesystem?: {
    worktree?: 'readWrite' | 'readOnly'
  }
  network?: {
    mode?: 'egress-allowlist' | 'none'
    allowlist?: string[]
  }
  credentials?: {
    mode?: 'scoped'
  }
  resources?: Record<string, unknown>
  process?: {
    mode?: 'namespaced'
  }
}

export type SandboxSpec = HostSandboxSpec | ContainerSandboxSpec | RemoteSandboxSpec
export type SandboxDriverId = SandboxSpec['kind']

export interface SandboxBoundaryDescriptor {
  filesystem: 'worktree-readWrite'
  network: 'host' | 'egress-allowlist' | 'none' | 'container-default'
  credentials: 'host' | 'scoped'
  resources: 'none'
  process: 'host' | 'namespaced'
}

export interface PreparedSandbox {
  driver: SandboxDriverId
  profile: {
    id: RunSandboxProfileSnapshot['id']
    name: string
    projectId: RunSandboxProfileSnapshot['projectId']
    provider: string
    mode: string
  }
  workingDir: string
  worktreePaths: string[]
  reusedWorktree: boolean
  boundary: SandboxBoundaryDescriptor
  podman?: {
    containerId: string
    runId: string
    command: string
    workdir: string
    runtimeHostDir?: string
    runtimeDir?: string
    proof?: {
      filePath: string
      nonce: string
    }
  }
}

export interface SandboxPrepareBundle<Spec extends SandboxSpec = SandboxSpec> {
  profile: RunSandboxProfileSnapshot
  spec: Spec
  runId: RunId
  taskName: string
  baseWorkingDir?: string
  inheritedWorktreePaths?: string[] | null
  worktreeManager?: WorktreeRuntimeManager
  projectName?: string
  setupCommands?: string[]
  setupEnv?: Record<string, string>
}

export interface SandboxDriver<Spec extends SandboxSpec = SandboxSpec> {
  readonly id: SandboxDriverId
  prepare(bundle: SandboxPrepareBundle<Spec>): Promise<PreparedSandbox>
  boundary(): SandboxBoundaryDescriptor
  teardown(prepared: PreparedSandbox): Promise<void> | void
}

export class HostSandboxDriver implements SandboxDriver<HostSandboxSpec> {
  readonly id = 'host'

  boundary(): SandboxBoundaryDescriptor {
    return { ...HOST_SANDBOX_BOUNDARY }
  }

  async prepare(bundle: SandboxPrepareBundle<HostSandboxSpec>): Promise<PreparedSandbox> {
    assertSupportedHostSandboxRuntime(bundle)
    const inherited = bundle.inheritedWorktreePaths ?? []
    if (inherited.length > 0) {
      return preparedSandbox(bundle.profile, this.id, inherited[0]!, inherited, true, this.boundary())
    }

    const manager = bundle.worktreeManager
    const baseWorkingDir = bundle.baseWorkingDir
    if (manager == null || baseWorkingDir == null) {
      throw sandboxError(bundle.profile, 'requires an enabled Ductum worktree manager and working directory')
    }
    const worktreePath = await manager.create(
      baseWorkingDir,
      bundle.taskName,
      bundle.runId,
      bundle.projectName,
      bundle.setupCommands,
      bundle.setupEnv,
    )
    if (worktreePath.trim() === '' || worktreePath === baseWorkingDir) {
      throw sandboxError(bundle.profile, `failed to create a Ductum-managed worktree for ${baseWorkingDir}`)
    }
    return preparedSandbox(bundle.profile, this.id, worktreePath, [worktreePath], false, this.boundary())
  }

  teardown(): void {}
}

export function parseSandboxSpec(profile: RunSandboxProfileSnapshot, resourceSpec: unknown): SandboxSpec {
  if (!isPlainObject(resourceSpec)) {
    throw sandboxError(profile, 'requires spec to be an object')
  }
  switch (sandboxKind(profile, resourceSpec)) {
    case 'host':
      return parseHostSandboxSpec(profile, resourceSpec)
    case 'container':
      return parseContainerSandboxSpec(profile, resourceSpec)
    case 'remote':
      throw sandboxError(profile, `unsupported sandbox runtime ${profile.provider}/${profile.mode}`)
  }
}

function sandboxKind(profile: RunSandboxProfileSnapshot, spec: Record<string, unknown>): SandboxDriverId {
  if (spec.kind === 'host' || spec.kind === 'container' || spec.kind === 'remote') return spec.kind
  return profile.provider === 'host' && profile.mode === 'worktree' ? 'host' : 'container'
}

function parseHostSandboxSpec(
  profile: RunSandboxProfileSnapshot,
  resourceSpec: Record<string, unknown>,
): HostSandboxSpec {
  if (profile.provider !== 'host' || profile.mode !== 'worktree') {
    throw sandboxError(profile, `unsupported sandbox runtime ${profile.provider}/${profile.mode}`)
  }
  const filesystem = parseFilesystem(profile, resourceSpec.filesystem)
  const network = parseNetwork(profile, resourceSpec.network)
  rejectNonEmpty(profile, 'credentials', resourceSpec.credentials)
  rejectNonEmpty(profile, 'resources', resourceSpec.resources)
  rejectNonEmpty(profile, 'process', resourceSpec.process)
  return {
    kind: 'host',
    provider: 'host',
    mode: 'worktree',
    ...(filesystem == null ? {} : { filesystem }),
    ...(network == null ? {} : { network }),
  }
}

export function assertSupportedHostSandboxRuntime(input: SandboxPrepareBundle<HostSandboxSpec>): void {
  const { profile, baseWorkingDir, inheritedWorktreePaths, worktreeManager } = input
  if (inheritedWorktreePaths != null && inheritedWorktreePaths.length > 0) {
    const inherited = inheritedWorktreePaths[0]
    if (typeof inherited !== 'string' || inherited.trim() === '') {
      throw sandboxError(profile, 'requires a non-empty inherited worktree path')
    }
    if (!existsSync(inherited)) {
      throw sandboxError(profile, `inherited worktree path no longer exists: ${inherited}`)
    }
    return
  }
  if (baseWorkingDir == null || baseWorkingDir.trim() === '') {
    throw sandboxError(profile, 'requires a resolved repository working directory')
  }
  if (worktreeManager == null || !worktreeManager.enabled) {
    throw sandboxError(profile, 'requires an enabled Ductum worktree manager')
  }
  if (!worktreeManager.isGitRepo(baseWorkingDir)) {
    throw sandboxError(profile, `requires a git repository working directory: ${baseWorkingDir}`)
  }
}

const HOST_SANDBOX_BOUNDARY: SandboxBoundaryDescriptor = {
  filesystem: 'worktree-readWrite',
  network: 'host',
  credentials: 'host',
  resources: 'none',
  process: 'host',
}

function parseFilesystem(profile: RunSandboxProfileSnapshot, value: unknown): HostSandboxFilesystemSpec | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.filesystem to be an object')
  const worktree = value.worktree
  if (worktree != null && worktree !== 'readWrite') {
    throw sandboxError(profile, `does not support filesystem.worktree=${String(worktree)}`)
  }
  const unsupported = Object.entries(value).filter(([key, item]) => key !== 'worktree' && hasNonEmptyValue(item))
  if (unsupported.length > 0) {
    throw sandboxError(profile, `does not support filesystem.${unsupported[0]![0]}`)
  }
  return worktree == null ? {} : { worktree: 'readWrite' }
}

function parseNetwork(profile: RunSandboxProfileSnapshot, value: unknown): HostSandboxNetworkSpec | undefined {
  if (value == null) return undefined
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.network to be an object')
  const mode = value.mode
  if (mode != null && mode !== 'host') {
    throw sandboxError(profile, `does not support network.mode=${String(mode)}`)
  }
  const unsupported = Object.entries(value).filter(([key, item]) => key !== 'mode' && hasNonEmptyValue(item))
  if (unsupported.length > 0) {
    throw sandboxError(profile, `does not support network.${unsupported[0]![0]}`)
  }
  return mode == null ? {} : { mode: 'host' }
}

export function preparedSandbox(
  profile: RunSandboxProfileSnapshot,
  driver: SandboxDriverId,
  workingDir: string,
  worktreePaths: string[],
  reusedWorktree: boolean,
  boundary: SandboxBoundaryDescriptor,
): PreparedSandbox {
  return {
    driver,
    profile: {
      id: profile.id,
      name: profile.name,
      projectId: profile.projectId,
      provider: profile.provider,
      mode: profile.mode,
    },
    workingDir,
    worktreePaths,
    reusedWorktree,
    boundary,
  }
}
