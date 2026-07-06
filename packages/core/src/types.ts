import { nanoid } from 'nanoid'
import type { EvidenceType, GateEvaluationResult, GateType, RunLatchStatus, SpecStatus, SpecStrategy, TaskStatus, TaskStrategyRole, TerminalState, WorkflowStage } from './lifecycle-types.js'
import type { AgentCapability, AgentEffort, AgentRole, Harness, MergeMode, TaskComplexity } from './type-values.js'
import type { SpecStrategyConfig } from './strategy-config-types.js'
import type { WorkItemSource } from './work-item-source.js'
export * from './lifecycle-types.js'
export * from './type-values.js'
export type { BestOfNPolicy, BestOfNSpecStrategyConfig, SpecStrategyConfig } from './strategy-config-types.js'
type Brand<T extends string> = string & { readonly __brand: T }

export type FactoryId = Brand<'FactoryId'>
export type ProjectId = Brand<'ProjectId'>
export type TargetId = Brand<'TargetId'>
export type ConfigResourceId = Brand<'ConfigResourceId'>
export type AgentId = Brand<'AgentId'>
export type SpecId = Brand<'SpecId'>
export type TaskId = Brand<'TaskId'>
export type DecisionId = Brand<'DecisionId'>
export type RunId = Brand<'RunId'>
export type EvidenceId = Brand<'EvidenceId'>

/** @deprecated Use WorkflowStage — kept only for migration/compat references */
export type RunStage = WorkflowStage

export interface Factory {
  id: FactoryId
  name: string
  config: FactoryConfig
  createdAt: string
}

export interface FactoryConfig {
  heartbeatTimeoutSeconds: number
  defaultMergeMode: MergeMode
  costBudget?: FactoryCostBudgetConfig
  attemptCeilings?: FactoryAttemptCeilingsConfig
}

export type FactoryCostBudgetConfig = { perRunWarnUsd?: number | null; perRunHardUsd?: number | null; perSpecHardUsd?: number | null }
export type FactoryAttemptCeilingsConfig = { enabled?: boolean | null; maxInputTokensPerTurn?: number | null; maxCumulativeCostUsd?: number | null; maxTurns?: number | null }

export interface Project {
  id: ProjectId
  factoryId: FactoryId
  name: string
  repos: string[]
  config: ProjectConfig
  createdAt: string
  updatedAt: string
}

export interface ProjectConfig {
  mergeMode: MergeMode
  workflowPath: string
  workflowProfileRef?: string
  workflowProfile?: string
  /** Blocks ship on linked branch, commit, PR, and green external watchers. */
  externalReviewRequired?: boolean
  purpose?: string; audience?: string
}

export interface Agent {
  id: AgentId
  name: string
  model: string
  harness: Harness
  providerId?: string | null
  accountId?: string | null
  resourceRefs?: AgentResourceRefs
  capabilities: AgentCapability[]
  effort?: AgentEffort | null
  costTier: number
  spawnConfig: AgentSpawnConfig
  /** Per-agent price-per-1M-tokens override, used before model-pricing.ts. */
  pricing?: { inputUsdPer1M: number; outputUsdPer1M: number } | null
  createdAt: string
}

export interface AgentSpawnConfig {
  port?: number
  workingDir?: string
  env?: Record<string, string>
}

export interface AgentResourceRefs {
  modelRef?: string
  harnessRef?: string
  workflowProfileRef?: string
  sandboxRef?: string
  systemPromptRef?: string
  toolsRef?: string
  policyRef?: string
}

export interface RunSandboxProfileSnapshot {
  id: ConfigResourceId
  name: string
  projectId: ProjectId | null
  provider: string
  mode: string
  spec: Record<string, unknown>
}

export interface RunWorkflowProfileSnapshot {
  id: ConfigResourceId
  name: string
  projectId: ProjectId | null
  path: string
  description?: string
  unattended?: WorkflowProfileUnattendedPolicy
  renderedWorkflow?: string
  setupCommands?: string[]
  verifyCommands?: string[]
}

export type WorkflowProfilePushRequirement = 'remote_ci' | 'local_verify'

export interface WorkflowProfileUnattendedPolicy { autoApprove: boolean; autoMerge: boolean; autoPush: boolean; pushRequires: WorkflowProfilePushRequirement }
export interface ProjectAgent {
  projectId: ProjectId
  agentId: AgentId
  role: AgentRole
}

export interface Spec {
  id: SpecId
  projectId: ProjectId
  name: string
  status: SpecStatus
  strategy: SpecStrategy
  strategyConfig: SpecStrategyConfig | null
  document: string
  source?: WorkItemSource | null
  /**
   * Per-spec override for the fix-loop iteration cap. When null, the
   * factory-wide default from postCompletion.maxFixIterations is used.
   * Read by PostCompletionRouter on every review/fix routing decision.
   */
  maxFixIterations: number | null
  createdAt: string
  updatedAt: string
}

export interface SpecDependency {
  specId: SpecId
  dependsOnId: SpecId
  kind: 'hard' | 'soft'
}

export interface Task {
  id: TaskId
  specId: SpecId
  targetId: TargetId | null
  repositoryId?: string | null
  componentId?: string | null
  name: string
  prompt: string
  repos: string[]
  source?: WorkItemSource | null
  assignedAgentId: AgentId | null
  requiredRole: AgentRole | null
  complexity: TaskComplexity | null
  status: TaskStatus
  strategyRole: TaskStrategyRole
  strategyGroup: string | null
  verification: string[]
  retryCount: number
  retryAfter: string | null
  budgetExtraUsd: number; turnExtraCount: number // D114, D118 extras.
  createdAt: string
  updatedAt: string
}

export interface TaskDependency {
  taskId: TaskId
  dependsOnId: TaskId
}

export interface Decision {
  id: DecisionId
  specId: SpecId | null
  taskId: TaskId | null
  runId: RunId | null
  decision: string
  context: string
  alternatives: string[] | null
  decidedBy: string
  supersedesId: DecisionId | null
  createdAt: string
}

export interface Run {
  id: RunId
  taskId: TaskId
  agentId: AgentId
  parentRunId: RunId | null
  stage: WorkflowStage
  terminalState: TerminalState | null
  resetCount: number
  completedStages: string[]
  blockedReason: string | null
  pendingApproval: boolean
  sessionId: string | null
  branch: string | null
  commitSha: string | null
  prNumber: number | null
  prUrl: string | null
  worktreePaths: string[] | null
  runtimeModel: string | null
  runtimeHarness: string | null
  runtimeSandboxProfile: RunSandboxProfileSnapshot | null
  runtimeWorkflowProfile: RunWorkflowProfileSnapshot | null
  attemptSnapshot?: import('./attempt-types.js').AttemptRuntimeSnapshot | null
  /** @deprecated Edictum workflow stages replace latch system */
  ciStatus: RunLatchStatus | null
  /** @deprecated Edictum workflow stages replace latch system */
  reviewStatus: RunLatchStatus | null
  failReason: string | null
  recoverable: boolean
  tokensIn: number
  tokensOut: number
  costUsd: number
  lastHeartbeat: string | null
  heartbeatTimeoutSeconds: number
  verifyRetries: number
  completionSummary: string | null
  createdAt: string
  updatedAt: string
}

export interface RunStageTransition {
  id: number
  runId: RunId
  fromStage: string
  toStage: string
  reason: string | null
  createdAt: string
}

export interface Evidence {
  id: EvidenceId
  runId: RunId
  type: EvidenceType
  payload: Record<string, unknown>
  createdAt: string
}

export interface GateEvaluation {
  id: number
  runId: RunId
  gateType: GateType
  target: string
  result: GateEvaluationResult
  reason: string | null
  /**
   * True when the record was created under observer mode — the
   * workflow runtime reported what it WOULD have blocked, but the
   * enforcement manager returned allowed=true to the caller anyway.
   * Dashboard renders these rows in a muted style so operators can
   * distinguish a dry-run block from a real one.
   */
  observed: boolean
  createdAt: string
}

export interface SessionRunMapping {
  sessionId: string
  runId: RunId
  harness: Harness
  controlToken: string
  workingDir?: string | null
  harnessSessionId?: string | null
  workerPid?: number | null
  workerOwnershipKind?: 'process-group' | 'direct-child' | null
  workerStartedAt?: string | null
  workerOwnershipUnsupportedReason?: string | null
  createdAt: string
}

export interface RunUpdate {
  id: number
  runId: RunId
  message: string
  createdAt: string
}

export type RunActivityKind = 'tool_call' | 'tool_result' | 'text' | 'summary' | 'result'

export interface RunActivity {
  id: number
  runId: RunId
  kind: RunActivityKind
  content: string
  toolName: string | null
  createdAt: string
}

export function createId<T extends string>(): Brand<T> {
  return nanoid(12) as Brand<T>
}
