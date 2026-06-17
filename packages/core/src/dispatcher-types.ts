import type {
  DispatcherMcpServer,
  HarnessAdapter,
  HarnessSession,
} from './dispatcher-support.js'
import type { Agent, AgentId, Run, RunId } from './types.js'

export interface ActiveDispatchSession {
  agentId: AgentId
  agent: Agent
  adapter: HarnessAdapter
  session: HarnessSession
  mcpServer: DispatcherMcpServer
  released: boolean
}

/**
 * Per-dispatch options set by the dispatcher itself based on task lineage.
 * Not user-facing; computed from task name before dispatch.
 */
export interface DispatchOptions {
  parentRunId?: RunId
  reuseWorktreeFromRunId?: RunId
}

export const NON_STALLABLE_STAGES = new Set<Run['stage']>(['done'])
export const END_SESSION_FALLBACK_DELAY_MS = 1_000
