import { existsSync } from 'node:fs'

import { AgentRuntimeResolutionError } from './agent-runtime-resolution.js'
import type { RunId, RunSandboxProfileSnapshot } from './types.js'
import type { WorktreeManager } from './worktree.js'

type WorktreeRuntimeManager = Pick<WorktreeManager, 'enabled' | 'isGitRepo' | 'create'>

export interface PreparedSandboxRuntime {
  driver: 'host-worktree'
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
  boundary: {
    filesystem: 'worktree-readWrite'
    network: 'host'
    credentials: 'none'
    resources: 'none'
    process: 'host'
  }
}

export interface SandboxRuntimePrepareInput {
  profile: RunSandboxProfileSnapshot
  resourceSpec: Record<string, unknown>
  runId: RunId
  taskName: string
  baseWorkingDir?: string
  inheritedWorktreePaths?: string[] | null
  worktreeManager?: WorktreeRuntimeManager
  projectName?: string
  setupCommands?: string[]
}

export function assertSupportedSandboxRuntime(input: SandboxRuntimePrepareInput): void {
  const { profile, baseWorkingDir, inheritedWorktreePaths, worktreeManager } = input
  assertSupportedSandboxProfileSpec(profile, input.resourceSpec)
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

export function assertSupportedSandboxProfileSpec(
  profile: RunSandboxProfileSnapshot,
  resourceSpec: unknown,
): void {
  if (profile.provider !== 'host' || profile.mode !== 'worktree') {
    throw sandboxError(profile, `unsupported sandbox runtime ${profile.provider}/${profile.mode}`)
  }
  // Provider/mode come from the resolved snapshot; raw resource spec carries unimplemented claims.
  const spec = resourceSpec as Record<string, unknown>
  validateFilesystem(profile, spec.filesystem)
  validateNetwork(profile, spec.network)
  rejectNonEmpty(profile, 'credentials', spec.credentials)
  rejectNonEmpty(profile, 'resources', spec.resources)
  rejectNonEmpty(profile, 'process', spec.process)
}

export async function prepareSandboxRuntime(input: SandboxRuntimePrepareInput): Promise<PreparedSandboxRuntime> {
  assertSupportedSandboxRuntime(input)
  const inherited = input.inheritedWorktreePaths ?? []
  if (inherited.length > 0) {
    return preparedRuntime(input.profile, inherited[0]!, inherited, true)
  }
  const manager = input.worktreeManager
  const baseWorkingDir = input.baseWorkingDir
  if (manager == null || baseWorkingDir == null) {
    throw sandboxError(input.profile, 'requires an enabled Ductum worktree manager and working directory')
  }
  const worktreePath = await manager.create(
    baseWorkingDir,
    input.taskName,
    input.runId,
    input.projectName,
    input.setupCommands,
  )
  if (worktreePath.trim() === '' || worktreePath === baseWorkingDir) {
    throw sandboxError(input.profile, `failed to create a Ductum-managed worktree for ${baseWorkingDir}`)
  }
  return preparedRuntime(input.profile, worktreePath, [worktreePath], false)
}

function validateFilesystem(profile: RunSandboxProfileSnapshot, value: unknown): void {
  if (value == null) return
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.filesystem to be an object')
  const worktree = value.worktree
  if (worktree != null && worktree !== 'readWrite') {
    throw sandboxError(profile, `does not support filesystem.worktree=${String(worktree)}`)
  }
  const unsupported = Object.entries(value).filter(([key, item]) => key !== 'worktree' && hasNonEmptyValue(item))
  if (unsupported.length > 0) {
    throw sandboxError(profile, `does not support filesystem.${unsupported[0]![0]}`)
  }
}

function validateNetwork(profile: RunSandboxProfileSnapshot, value: unknown): void {
  if (value == null) return
  if (!isPlainObject(value)) throw sandboxError(profile, 'requires spec.network to be an object')
  const mode = value.mode
  if (mode != null && mode !== 'host') {
    throw sandboxError(profile, `does not support network.mode=${String(mode)}`)
  }
  const unsupported = Object.entries(value).filter(([key, item]) => key !== 'mode' && hasNonEmptyValue(item))
  if (unsupported.length > 0) {
    throw sandboxError(profile, `does not support network.${unsupported[0]![0]}`)
  }
}

function rejectNonEmpty(profile: RunSandboxProfileSnapshot, field: string, value: unknown): void {
  if (!hasNonEmptyValue(value)) return
  throw sandboxError(profile, `does not support spec.${field}`)
}

function hasNonEmptyValue(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.some(hasNonEmptyValue)
  if (isPlainObject(value)) return Object.values(value).some(hasNonEmptyValue)
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function preparedRuntime(
  profile: RunSandboxProfileSnapshot,
  workingDir: string,
  worktreePaths: string[],
  reusedWorktree: boolean,
): PreparedSandboxRuntime {
  return {
    driver: 'host-worktree',
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
    boundary: {
      filesystem: 'worktree-readWrite',
      network: 'host',
      credentials: 'none',
      resources: 'none',
      process: 'host',
    },
  }
}

function sandboxError(profile: RunSandboxProfileSnapshot, reason: string): AgentRuntimeResolutionError {
  return new AgentRuntimeResolutionError(
    `SandboxProfile ${profile.name} (${profile.provider}/${profile.mode}) ${reason}`,
    'resource_malformed',
  )
}
