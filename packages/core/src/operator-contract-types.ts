import type {
  AgentCapability,
  AgentEffort,
  AgentRole,
  SpecStatus,
  SpecStrategy,
  SpecStrategyConfig,
  TaskComplexity,
  TaskStatus,
  TaskStrategyRole,
  WorkflowStage,
} from './types.js'
import type { OperatorAttemptSnapshot } from './attempt-types.js'
import type { RepositoryGitReadiness, RepositoryIdentity } from './resource-types.js'
import type { DisplayStatus } from './run-display.js'

export type { AttemptRuntimeSnapshot, OperatorAttemptSnapshot } from './attempt-types.js'

export type OperatorRecordType =
  | 'Project'
  | 'Repository'
  | 'Component'
  | 'Spec'
  | 'Task'
  | 'Attempt'
  | 'Agent'
  | 'Provider'
  | 'Model'
  | 'Harness'
  | 'Workflow'
  | 'Factory Activity'
  | 'Repair'

export type OperatorLifecycleStatus =
  | 'ok'
  | 'running'
  | 'needs_attention'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'unknown'

export interface OperatorRecordBase<T extends OperatorRecordType> {
  recordType: T
  id: string
  name: string
  label?: string
}

export interface OperatorProject extends OperatorRecordBase<'Project'> {
  repositoryCount: number
  status: OperatorLifecycleStatus
  workflowName?: string | null
}

export interface OperatorRepository extends OperatorRecordBase<'Repository'> {
  projectId?: string
  localPath?: string
  remoteUrl?: string
  identity?: RepositoryIdentity
  portable?: boolean
  readiness?: RepositoryGitReadiness
  components?: OperatorComponent[]
}

export interface OperatorComponent extends OperatorRecordBase<'Component'> {
  repositoryId?: string
  repositoryName: string
  path?: string
}

export interface OperatorSpec extends OperatorRecordBase<'Spec'> {
  projectId: string
  status: SpecStatus
  strategy: SpecStrategy
  strategyConfig?: SpecStrategyConfig | null
  document?: string
  taskCount?: number
}

export interface OperatorTask extends OperatorRecordBase<'Task'> {
  specId: string
  repositoryId?: string | null
  componentId?: string | null
  repositoryName: string
  componentName?: string
  status: TaskStatus
  strategyRole: TaskStrategyRole
  strategyGroup?: string | null
  prompt?: string
  verification?: string[]
  assignedAgentId?: string | null
  requiredRole?: AgentRole | null
  complexity?: TaskComplexity | null
}

export interface OperatorAttempt extends OperatorRecordBase<'Attempt'> {
  taskId: string
  agentId: string
  stage: WorkflowStage
  status: OperatorLifecycleStatus
  ui?: {
    schemaVersion: 'ductum.ui.run.v1'
    status: {
      key: DisplayStatus
      label: string
      tone: 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'mid'
      terminal: boolean
      needsAttention: boolean
    }
    cost: {
      usd: number
      label: string
      state: 'measured' | 'pending' | 'unpriced' | 'unmeasured'
    }
    href: string | null
  }
  parentAttemptId?: string | null
  branch?: string | null
  commitSha?: string | null
  prUrl?: string | null
  snapshot: OperatorAttemptSnapshot
}

export interface OperatorAgent extends OperatorRecordBase<'Agent'> {
  modelRef?: string
  harnessRef?: string
  providerId?: string | null
  accountId?: string | null
  capabilities: AgentCapability[]
  effort?: AgentEffort | null
}

export interface OperatorProvider extends OperatorRecordBase<'Provider'> {
  kind: string
  configured: boolean
}

export interface OperatorModel extends OperatorRecordBase<'Model'> {
  providerName: string
  providerModelId: string
  supportedHarnesses?: string[]
}

export interface OperatorHarness extends OperatorRecordBase<'Harness'> {
  type: string
  supportedSandboxes?: string[]
}

export interface OperatorWorkflow extends OperatorRecordBase<'Workflow'> {
  path: string
  description?: string
}

export interface OperatorFactoryActivity extends OperatorRecordBase<'Factory Activity'> {
  kind: string
  status: OperatorLifecycleStatus
  occurredAt: string
  projectId?: string
  taskId?: string
  attemptId?: string
}

export interface OperatorRepair extends OperatorRecordBase<'Repair'> {
  taskId: string
  attemptId?: string
  status: OperatorLifecycleStatus
  reason: string
  suggestedAction?: string
}

export type OperatorPublicRecord =
  | OperatorProject
  | OperatorRepository
  | OperatorComponent
  | OperatorSpec
  | OperatorTask
  | OperatorAttempt
  | OperatorAgent
  | OperatorProvider
  | OperatorModel
  | OperatorHarness
  | OperatorWorkflow
  | OperatorFactoryActivity
  | OperatorRepair

export type SpecIntakeSchemaVersion = 'ductum.spec-intake.v1'

export interface SpecIntake {
  schemaVersion: SpecIntakeSchemaVersion
  project: SpecIntakeProject
  repositories: SpecIntakeRepository[]
  spec: SpecIntakeSpec
}

export type WorkPackage = SpecIntake

export interface SpecIntakeProject {
  name: string
  id?: string
}

export interface SpecIntakeRepository {
  name: string
  id?: string
  targetRef?: string
  localPath?: string
  remoteUrl?: string
  components?: SpecIntakeComponent[]
  tasks?: SpecIntakeTask[]
}

export interface SpecIntakeComponent {
  name: string
  path?: string
  targetRef?: string
  tasks?: SpecIntakeTask[]
}

export interface SpecIntakeSpec {
  name: string
  status?: SpecStatus
  document?: string
  maxFixIterations?: number
}

/** Generator input stops at Task. Attempts are created by Ductum at runtime. */
export interface SpecIntakeTask {
  name: string
  prompt: string
  verification?: string[]
  dependsOn?: string[]
  assignedAgent?: string
  complexity?: TaskComplexity
  requiredRole?: AgentRole
  status?: TaskStatus
  targetRef?: string
}

// Factory Settings read/write DTOs are part of the public operator contract.
// Canonical declarations live in factory-settings-types.ts; consumers that
// reach core through the operator-contract alias import them from here.
export type {
  FactoryRuntimeCurrentSettings,
  FactoryRuntimeDesiredSettings,
  FactoryRuntimeMergeConfig,
  FactoryRuntimePatch,
  FactoryRuntimePersistedSettings,
  FactoryRuntimeSettings,
  FactoryRuntimeWorkflowProfileConfig,
  FactoryRuntimeWorkflowProfileEntry,
  FactorySecretMetadata,
  FactorySecretScope,
  FactorySecretStatus,
  FactorySettingsAffectedRuntime,
  FactorySettingsAgent,
  FactorySettingsBudgetPreferences,
  FactorySettingsCatalogs,
  FactorySettingsCostBudgetInput,
  FactorySettingsDetails,
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsNotificationChannel,
  FactorySettingsPatch,
  FactorySettingsProvider,
  FactorySettingsRuntimePreferences,
  FactorySettingsSandboxProfile,
  FactorySettingsSource,
  FactorySettingsWorkflow,
  FactorySettingsWorkflowValidation,
  FactorySettingsWriteResult,
} from './factory-settings-types.js'

export interface PublicContractMissingDependency {
  recordType: string
  idOrName: string
}

export interface PublicContractIssue {
  recordType: string
  recordId?: string
  recordName?: string
  fieldPath: string
  humanLabel: string
  invalidValue?: unknown
  missingDependency?: PublicContractMissingDependency
  suggestedAction: string
}
