import type { ConfigResourceId, ProjectId, TargetId } from './types.js'

type Brand<T extends string> = string & { readonly __brand: T }

export type RepositoryId = Brand<'RepositoryId'>
export type ComponentId = Brand<'ComponentId'>

export type TargetSourceType =
  | 'github'
  | 'local'
  | 'monorepo-package'
  | 'subdirectory'
  | 'docs-site'
  | 'app'
  | 'service'

export interface TargetSource {
  type: TargetSourceType
  repo?: string
  localPath?: string
  package?: string
  subdirectory?: string
}

export interface TargetBranch {
  base?: string
  prefix?: string
}

export interface TargetSpec {
  source: TargetSource
  branch?: TargetBranch
  workflowRef?: string
  authRef?: string
}

export interface Target {
  id: TargetId
  projectId: ProjectId
  name: string
  spec: TargetSpec
  createdAt: string
  updatedAt: string
}

export type RepositoryIdentityKind = 'remote' | 'local'

export interface RepositoryIdentity {
  kind: RepositoryIdentityKind
  value: string
  portable: boolean
}

export type RepositoryReadinessState =
  | 'ready'
  | 'configured'
  | 'unknown'
  | 'not_checked'
  | 'missing'
  | 'not_applicable'

export interface RepositoryGitReadiness {
  portable: boolean
  supportsLocalWorkflow: boolean
  supportsRemoteWorkflow: boolean
  local: {
    state: RepositoryReadinessState
    path?: string
  }
  git: {
    state: RepositoryReadinessState
    remoteUrl?: string
    defaultBranch?: string
  }
  github: {
    state: RepositoryReadinessState
    owner?: string
    repo?: string
    reason?: string
  }
}

export interface RepositorySpec {
  remoteUrl?: string
  localPath?: string
  defaultBranch?: string
  branchPrefix?: string
  authRef?: string
  targetRef?: TargetId
}

export interface Repository {
  id: RepositoryId
  projectId: ProjectId
  name: string
  identity: RepositoryIdentity
  portable: boolean
  readiness: RepositoryGitReadiness
  spec: RepositorySpec
  createdAt: string
  updatedAt: string
}

export interface ComponentSpec {
  path?: string
  targetRef?: TargetId
}

export interface Component {
  id: ComponentId
  repositoryId: RepositoryId
  name: string
  spec: ComponentSpec
  createdAt: string
  updatedAt: string
}

export type ConfigResourceKind =
  | 'WorkflowProfile'
  | 'Model'
  | 'Harness'
  | 'SandboxProfile'
  | 'NotificationChannel'

export interface WorkflowProfileSpec {
  path: string
  description?: string
}

export interface ModelSpec {
  provider: string
  modelId: string
  accessRef?: string
  supportedEfforts?: string[]
  supportedOptions?: string[]
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number }
  scannerSource?: string
  sourceUrl?: string
  lastVerifiedAt?: string
  enabled?: boolean
}

export interface HarnessSpec {
  type: string
  command?: string
  runtime?: string
  controlMode?: string
  supportedSandboxes?: string[]
  supportedProviders?: string[]
  requiredSecretRefs?: string[]
  restartBehavior?: string
  testCommand?: string
}

export interface SandboxProfileSpec {
  provider: string
  mode: string
  filesystem?: Record<string, unknown>
  network?: Record<string, unknown>
  credentials?: Record<string, unknown>
  resources?: Record<string, unknown>
  /** Preserved shell claim; current host/worktree runtime rejects non-empty values. */
  process?: Record<string, unknown>
}

export interface NotificationChannelSpec {
  backend: 'telegram'
  config?: Record<string, unknown>
}

export type ConfigResourceSpec =
  | WorkflowProfileSpec
  | ModelSpec
  | HarnessSpec
  | SandboxProfileSpec
  | NotificationChannelSpec

export interface ConfigResource {
  id: ConfigResourceId
  kind: ConfigResourceKind
  projectId: ProjectId | null
  name: string
  spec: ConfigResourceSpec
  createdAt: string
  updatedAt: string
}
