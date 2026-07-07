import type { Agent, AgentId, Run, RunId, RunWorkflowProfileSnapshot, Task, TaskId, WorkflowStage } from './types.js'
import type { PreparedSandboxRuntime } from './sandbox-runtime.js'
import type { WorkflowProfileRuntimeData } from './workflow-profile-runtime.js'
import type { PrerequisiteIssue } from './repair-types.js'
import { formatUnknownError } from './error-format.js'
import type { CostTruthState } from './cost-truth.js'
import type { AttemptResourceCeilingSettings } from './attempt-resource-ceilings.js'
import type { PriorAttemptFailure } from './dispatcher-types.js'
import type { DispatcherWorkspacePreflightOverride, WorkspacePreflightConfig, WorkspacePreflightProbes } from './workspace-preflight-types.js'

export type { AttemptResourceCeilings, AttemptResourceCeilingSettings } from './attempt-resource-ceilings.js'

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
  turns?: number
  maxInputTokensInTurn?: number
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
  /** Harness-native hard cap for a single agent session, when supported. */
  maxTurns?: number
  /** Harness-native cost cap for a single agent session, when supported. */
  maxBudgetUsd?: number
  /** Harness-side preemptive cap for a single turn's input tokens, when supported. */
  maxInputTokensPerTurn?: number
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
  attemptCeilings?: AttemptResourceCeilingSettings | null
  attemptCeilingsSource?: 'env' | 'factory' | null
  now?: () => Date
  /**
   * Build the dispatcher-authored system prompt for a dispatching run.
   *
   * The optional `context` arg (#282) carries `priorAttemptFailure` when the
   * dispatch is a resume after a recoverable failure. Custom implementations
   * should embed the prior failure so the retried agent does not replay the
   * same unbounded context growth; the default `buildDispatcherSystemPrompt`
   * already does this.
   */
  buildSystemPrompt?: (task: Task, run: Run, context?: { priorAttemptFailure?: PriorAttemptFailure }) => string
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
  resolveWorkspacePreflight?: (projectName: string, workflowProfile?: RunWorkflowProfileSnapshot) => WorkspacePreflightConfig | undefined
  validateWorkflowProfile?: (workflowProfile: RunWorkflowProfileSnapshot) => WorkflowProfileRuntimeData
  preDispatchCheck?: (task: Task, agent: Agent) => PrerequisiteIssue[]
  /** Optional #281 workspace preflight override for dispatcher tests. */
  runWorkspacePreflight?: DispatcherWorkspacePreflightOverride
  /** Optional #281 workspace preflight probes for dispatcher tests. */
  workspacePreflightProbes?: WorkspacePreflightProbes
  /**
   * Resolve the scoped environment for an agent at dispatch (ScopedSecretBroker.materializeEnv).
   * Injected by the API so the dispatcher never holds the FactorySecret store. Undefined = legacy
   * full-host-env behavior.
   *
   * The `context` argument carries the run/agent identity that the broker
   * threads into the resolver so each secret access can be attributed to the
   * dispatch that requested it (P1 / issue #210 secret access log).
   */
  materializeAgentEnv?: (
    agent: Agent,
    context: { runId: RunId; agentId: AgentId },
  ) => { env: Record<string, string>; droppedKeys: string[] }
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

export function buildDispatcherSystemPrompt(task: Task, options?: { findings?: string; resetCount?: number; workingDir?: string; priorAttemptFailure?: PriorAttemptFailure }): string {
  const verification = task.verification.length === 0 ? 'No explicit verification steps.' : task.verification.map((v, i) => `${i + 1}. ${v}`).join('\n')
  const repoScope = options?.workingDir == null || options.workingDir.trim() === ''
    ? task.repos.length === 0 ? 'Use the project working directory.' : task.repos.join(', ')
    : `Use this run working directory for all file reads and writes: ${options.workingDir}. Do not use original repository source paths as workspaces.`
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
    ...(options?.priorAttemptFailure != null ? renderPriorAttemptFailure(options.priorAttemptFailure) : []),
  ].join('\n')
}

/**
 * Render the prior-attempt-failure section for the dispatcher system prompt
 * (#282). The text is advisory for the agent (C2: structural enforcement is
 * the workflow gates' job) but it changes the retry's first move from "start
 * over" to "be cheap about reads" so a prompt_overflow retry does not simply
 * re-die on the same unbounded context growth.
 */
function renderPriorAttemptFailure(failure: PriorAttemptFailure): string[] {
  // `max_turns_paused: attempt input tokens per turn N exceeded cap M` is the
  // freeze shape applyAttemptResourceCeilings produces when it catches a
  // harness prompt_overflow (#282). Treat it as overflow for retry guidance.
  const overflow = /prompt[_ -]?overflow|prompt is too long|context[_ ]?window|max_turns_paused: attempt input tokens per turn/i.test(failure.failReason)
  const turnHint = failure.turns > 0 ? ` after ~${failure.turns} agent turns` : ''
  const peakHint = failure.maxInputTokensInTurn > 0
    ? ` (peak ${failure.maxInputTokensInTurn.toLocaleString('en-US')} input tokens in a single turn)`
    : failure.tokensIn > 0
      ? ` (~${failure.tokensIn.toLocaleString('en-US')} cumulative input tokens)`
      : ''
  const headline = `The previous attempt for this task died from \`${failure.failReason}\`${turnHint}${peakHint}. Do NOT simply repeat its investigation.`
  if (!overflow) {
    return [
      '',
      '## Previous Attempt Failure',
      '',
      headline,
      '',
      'Address the underlying cause before resuming the same workflow. If the failure shape is repeatable, change approach before reading or writing more.',
    ]
  }
  return [
    '',
      '## Previous Attempt Failure - prompt overflow',
    '',
    headline,
    '',
    'The prior attempt exhausted the model context window. To avoid dying the same way:',
    '',
    '1. Use `Read` with `offset` and `limit` for big files instead of reading them whole.',
    '2. Use `Grep` to find symbols first; only `Read` the specific span you need.',
    '3. Do not re-read files you have already read this turn; summarize from your prior context instead.',
    '4. Prefer `Glob` to locate files, then read only the smallest viable slice.',
    '5. If the work genuinely needs more context than the model window allows, split the task and report it via `ductum_update` instead of pushing through.',
    '',
    'Investigate cheaply first. The goal is to land the fix, not to re-trace the full prior investigation.',
  ]
}

export function toErrorMessage(error: unknown): string {
  return formatUnknownError(error)
}
