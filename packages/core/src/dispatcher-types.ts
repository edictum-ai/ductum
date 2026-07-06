import type {
  DispatcherMcpServer,
  HarnessAdapter,
  HarnessSession,
} from './dispatcher-support.js'
import type { AttemptLease } from './attempt-lease.js'
import type { Agent, AgentId, Run, RunId, WorkflowStage } from './types.js'
import type { PreparedSandboxRuntime } from './sandbox-runtime.js'

export interface ActiveDispatchSession {
  agentId: AgentId
  agent: Agent
  adapter: HarnessAdapter
  session: HarnessSession
  mcpServer: DispatcherMcpServer
  sandboxRuntime?: PreparedSandboxRuntime
  released: boolean
  lease?: AttemptLease | null
  initialTokensIn?: number
  initialTokensOut?: number
  initialCostUsd?: number
}

/**
 * Per-dispatch options set by the dispatcher itself based on task lineage.
 * Not user-facing; computed from task name before dispatch.
 */
export interface DispatchOptions {
  parentRunId?: RunId
  reuseWorktreeFromRunId?: RunId
  /**
   * Checkpoint/resume (design/04 §1): when set, the dispatched run starts
   * at this stage (reusing the worktree named by reuseWorktreeFromRunId)
   * and its Edictum workflow is seeded forward via setStage, instead of a
   * fresh run at `understand`.
   */
  resumeFromStage?: WorkflowStage
}

export const NON_STALLABLE_STAGES = new Set<Run['stage']>(['done'])
export const END_SESSION_FALLBACK_DELAY_MS = 1_000
export const COMPLETION_RELEASE_TIMEOUT_MS = 5_000
