import type { ComponentId, RepositoryGitReadiness, RepositoryId } from './resource-types.js'
import type {
  AgentCapability,
  AgentEffort,
  AgentId,
  AgentRole,
  AgentResourceRefs,
  AgentSpawnConfig,
  ConfigResourceId,
  Harness,
  ProjectConfig,
  ProjectId,
  RunId,
  RunSandboxProfileSnapshot,
  RunWorkflowProfileSnapshot,
  SpecId,
  TaskId,
} from './types.js'

export type AttemptId = RunId
export type AttemptSnapshotCompleteness = 'full' | 'partial-legacy'

export interface AttemptRecordRef {
  id: string
  name: string
}

export interface AttemptRepositorySnapshot extends AttemptRecordRef {
  id: RepositoryId | string
  projectId: ProjectId | string
  localPath?: string
  remoteUrl?: string
  defaultBranch?: string
  branchPrefix?: string
  readiness?: RepositoryGitReadiness
}

export interface AttemptComponentSnapshot extends AttemptRecordRef {
  id: ComponentId | string
  repositoryId: RepositoryId | string
  path?: string
}

export interface AttemptAgentSnapshot extends AttemptRecordRef {
  id: AgentId | string
  model: string
  harness: Harness | string
  resourceRefs?: AgentResourceRefs
  capabilities: AgentCapability[]
  effort?: AgentEffort | null
  costTier: number
  spawnConfig: AgentSpawnConfig
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null
  role?: AgentRole | null
  systemPromptRef?: string
}

export interface AttemptProviderSnapshot {
  providerId: string
}

export interface AttemptModelSnapshot {
  modelId: string
  providerModelId?: string
  resourceId?: ConfigResourceId | string
  resourceName?: string
}

export interface AttemptHarnessSnapshot {
  harnessId: string
  adapterKey: string
  resourceId?: ConfigResourceId | string
  resourceName?: string
}

export interface AttemptExecutionSnapshot {
  hostId?: string
  workingDir?: string
  worktreePaths?: string[]
  branch?: string | null
  defaultBranch?: string
  branchPrefix?: string
}

export interface AttemptRuntimeSnapshot {
  capturedAt: string
  spec: AttemptRecordRef & { id: SpecId | string }
  task: AttemptRecordRef & { id: TaskId | string }
  project: AttemptRecordRef & { id: ProjectId | string; config: ProjectConfig }
  repository?: AttemptRepositorySnapshot
  component?: AttemptComponentSnapshot | null
  agent: AttemptAgentSnapshot
  provider: AttemptProviderSnapshot
  model: AttemptModelSnapshot
  harness: AttemptHarnessSnapshot
  workflow: RunWorkflowProfileSnapshot | null
  sandboxProfile: RunSandboxProfileSnapshot | null
  execution: AttemptExecutionSnapshot
}

export interface OperatorAttemptSnapshot {
  completeness: AttemptSnapshotCompleteness
  legacy: boolean
  capturedAt?: string
  runtime: Partial<AttemptRuntimeSnapshot>
  missingFields: string[]
}
