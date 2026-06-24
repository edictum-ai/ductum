import type { Agent, Run, RunId, RunWorkflowProfileSnapshot, Task, TaskId, WorkflowStage } from './types.js'
import type { PreparedSandboxRuntime } from './sandbox-runtime.js'
import type { WorkflowProfileRuntimeData } from './workflow-profile-runtime.js'
import type { PrerequisiteIssue } from './repair-types.js'
import { formatUnknownError } from './error-format.js'
import type { CostTruthState } from './cost-truth.js'

export interface DispatcherMcpServer {
  close?(): Promise<void> | void
  setControlToken?(controlToken: string | null): void
}

export interface HarnessSessionResult {
  exitReason:
    | 'completed'
    | 'crashed'
    | 'killed'
    | 'timeout'
    | 'failed'
    | 'paused-max-turns'
    | 'paused-cost-budget'
  tokensIn: number
  tokensOut: number
  costUsd: number
  costState?: CostTruthState
  /** Terminal harness-level failure reason, e.g. prompt_overflow. */
  failReason?: string
  /** Structured evidence payload forwarded to core when exitReason='failed'. */
  failureEvidence?: Record<string, unknown>
  /** Pause-context, populated when exitReason indicates a recoverable pause. D114/D118. */
  pauseDetail?: {
    /** e.g. "200 of 200 turns reached" or "$30 of $30 SDK budget reached" */
    detail: string
    /** Effective cap that was hit. */
    cap: number
  }
}

export interface HarnessSandboxExecution {
  agentProcess: 'host' | 'podman-container'
  containerId?: string
  workdir?: string
}

export interface HarnessSession {
  sessionId: string
  /** Stable provider-side session id used by the local cost scanner. */
  harnessSessionId?: string | null
  /** Best-effort host worker ownership metadata for restart cleanup. */
  workerPid?: number | null
  workerOwnershipKind?: 'process-group' | 'direct-child' | null
  workerStartedAt?: string | null
  workerOwnershipUnsupportedReason?: string | null
  runId: RunId
  /** Actual process boundary used by the harness for the agent process. */
  sandboxExecution?: HarnessSandboxExecution
  waitForCompletion(): Promise<HarnessSessionResult>
}

export interface SpawnOptions {
  /** Filesystem path the agent should use as cwd. Resolved by the dispatcher from task.repos + project config. */
  workingDir?: string
  /** Per-session secret used to authenticate harness-only control callbacks. */
  controlToken?: string
  /** Full agent config from the trusted dispatcher path. Avoids fetching secrets through public API routes. */
  agent?: Agent
  /** Prepared sandbox runtime selected from the agent's SandboxProfile resource. */
  sandbox?: PreparedSandboxRuntime
  /**
   * Scoped environment resolved by the ScopedSecretBroker at dispatch. When present, the harness
   * uses it instead of spreading the host process.env. Undefined falls back to legacy behavior.
   */
  env?: Record<string, string>
}

export type HarnessKillReason = 'killed' | 'completed' | 'cancelled'

export interface HarnessAdapter {
  spawn(run: Run, task: Task, systemPrompt: string, mcpServer: DispatcherMcpServer, options?: SpawnOptions): Promise<HarnessSession>
  /**
   * Terminate a live session.
   *
   * `reason` distinguishes forced kills from clean ductum.complete
   * terminations so handleSessionEnd can still run the post-completion
   * pipeline (verify → review → ship) for completed-reason ends.
   * Default is `'killed'` so legacy callers keep their exit semantics.
   */
  kill(sessionId: string, reason?: HarnessKillReason): Promise<void>
  isAlive(sessionId: string): Promise<boolean>
}

export interface DispatcherConfig {
  pollIntervalMs?: number
  maxConcurrentRuns?: number
  enabled?: boolean
  disabledReason?: string
  heartbeatTimeoutSeconds?: number
  /** Max number of automatic retries for stalled tasks. Default: 3. */
  maxTaskRetries?: number
  /** Backoff schedule in milliseconds for stalled task retries. Default: [10_000, 30_000, 60_000]. */
  retryBackoffScheduleMs?: readonly number[]
  /** Max time (ms) an auto-wait may sleep before resuming a transient/near-reset
   *  provider limit; beyond this the run fails over or freezes (design/04 §5). */
  maxAutoWaitMs?: number
  now?: () => Date
  buildSystemPrompt?: (task: Task, run: Run) => string
  createMcpServer?: (runId: RunId) => DispatcherMcpServer | Promise<DispatcherMcpServer>
  /**
   * Seed a resumed run's Edictum workflow forward to a checkpointed stage
   * (design/04 §1). Injected by the API as
   * `(runId, stage) => enforcement.advanceToStage(runId, stage)`, which
   * uses the D28-compliant `setStage()` forward primitive. Undefined →
   * resume falls back to today's fresh-Run dispatch for non-first stages.
   */
  seedWorkflowStage?: (runId: RunId, stage: WorkflowStage) => Promise<void> | void
  /** Given a repo name from task.repos, return the filesystem path. Used to set agent cwd. */
  resolveRepoPath?: (repoName: string) => string | undefined
  /** Resolve setup commands from the workflow profile for a project. Run in worktree after checkout. */
  resolveSetupCommands?: (projectName: string, workflowProfile?: RunWorkflowProfileSnapshot) => string[] | undefined
  validateWorkflowProfile?: (workflowProfile: RunWorkflowProfileSnapshot) => WorkflowProfileRuntimeData
  preDispatchCheck?: (task: Task, agent: Agent) => PrerequisiteIssue[]
  /**
   * Resolve the scoped environment for an agent at dispatch (ScopedSecretBroker.materializeEnv).
   * Injected by the API so the dispatcher never holds the FactorySecret store. Undefined = legacy
   * full-host-env behavior.
   */
  materializeAgentEnv?: (agent: Agent) => { env: Record<string, string>; droppedKeys: string[] }
}

export interface DispatchResult {
  tasksEvaluated: number
  tasksDispatched: TaskId[]
  errors: Array<{ taskId: TaskId; error: string }>
}

export interface DispatcherStatus {
  running: boolean
  activeRuns: number
  maxConcurrentRuns: number
  lastCycleAt: string | null
  enabled: boolean
  adapterCount: number
  adapters: string[]
  reason?: string | null
}

export const DEFAULT_RETRY_BACKOFF_SCHEDULE_MS = [10_000, 30_000, 60_000] as const
export const DEFAULT_MAX_TASK_RETRIES = 3

export type ResolvedDispatcherConfig =
  Required<Pick<DispatcherConfig, 'pollIntervalMs' | 'maxConcurrentRuns' | 'enabled' | 'heartbeatTimeoutSeconds' | 'maxTaskRetries' | 'retryBackoffScheduleMs'>> &
  Omit<DispatcherConfig, 'pollIntervalMs' | 'maxConcurrentRuns' | 'enabled' | 'heartbeatTimeoutSeconds' | 'maxTaskRetries' | 'retryBackoffScheduleMs'>

export const DEFAULT_DISPATCHER_CONFIG = {
  pollIntervalMs: 10_000,
  maxConcurrentRuns: 3,
  enabled: true,
  heartbeatTimeoutSeconds: 120,
  maxTaskRetries: DEFAULT_MAX_TASK_RETRIES,
  retryBackoffScheduleMs: DEFAULT_RETRY_BACKOFF_SCHEDULE_MS as readonly number[],
} as const

export function buildDispatcherSystemPrompt(task: Task, options?: { findings?: string; resetCount?: number }): string {
  const verification = task.verification.length === 0 ? 'No explicit verification steps.' : task.verification.map((v, i) => `${i + 1}. ${v}`).join('\n')
  const repoScope = task.repos.length === 0 ? 'Use the project working directory.' : task.repos.join(', ')
  return [
    'You are working on a task managed by Ductum, an AI factory orchestration system.',
    '',
    '## Task',
    task.prompt,
    '',
    '## Repo Scope',
    repoScope,
    '',
    '## Workflow',
    '',
    'This run is governed by an enforced workflow. The system blocks tools that are',
    'not allowed at the current stage and auto-advances when exit conditions are met.',
    '',
    'YOUR FIRST ACTION: Call `ductum_workflow` to discover the stages, allowed tools,',
    'and exit conditions. This tells you exactly what you can do and what advances you.',
    '',
    'The workflow is project-specific — do NOT assume the stages. Read them from the tool.',
    '',
    'After reading the workflow:',
    '1. Do the work for each stage — the system advances you automatically.',
    '2. Call `ductum_update` periodically to report progress.',
    '3. When done, call `ductum_complete` with a result describing what you built.',
    '',
    'Do not push branches or try to merge. Ductum owns verification, review,',
    'shipping, merge, and any remote push after `ductum_complete` ends the run.',
    'If a gate blocks `git push`, that is expected; finish with `ductum_complete`.',
    '',
    'IMPORTANT: The MCP tools are available through the "ductum" MCP server.',
    'Tools: ductum_workflow, ductum_update, ductum_evidence, ductum_complete.',
    '',
    '## Verification',
    verification,
    ...(options?.findings != null ? [
      '',
      '## Previous Attempt Findings',
      '',
      `This is retry attempt #${options.resetCount ?? 1}. The previous attempt had these issues:`,
      '',
      options.findings,
      '',
      'Fix these specific issues. Do not start from scratch.',
    ] : []),
  ].join('\n')
}

export function toErrorMessage(error: unknown): string {
  return formatUnknownError(error)
}
