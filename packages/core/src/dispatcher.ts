import { DispatcherRecovery } from './dispatcher-recovery.js'
import type { DispatcherMcpServer } from './dispatcher-support.js'
import {
  reconcileOrphanedSessions,
  type OrphanReconcileSummary,
} from './dispatcher-reconcile.js'
import type { Run, RunId } from './types.js'

export {
  DEFAULT_DISPATCHER_CONFIG,
  DEFAULT_MAX_TASK_RETRIES,
  DEFAULT_RETRY_BACKOFF_SCHEDULE_MS,
  type DispatchResult,
  type DispatcherConfig,
  type DispatcherMcpServer,
  type DispatcherStatus,
  type HarnessAdapter,
  type HarnessKillReason,
  type HarnessSession,
  type HarnessSessionResult,
  type ReattachContext,
  type SpawnOptions,
} from './dispatcher-support.js'
export type { AgentHealthState } from './dispatcher-agent-health.js'

// parseTaskName + PostCompletionRouter live in ./post-completion-router.js.
// Re-export parseTaskName for existing consumers that imported it from here.
export { parseTaskName } from './post-completion-router.js'

export class Dispatcher extends DispatcherRecovery {
  /**
   * Decision 121 (P3.1): on startup, reattach any active run whose
   * harness adapter supports it; mark the rest stalled with the
   * explicit reason. Idempotent.
   */
  async reconcileOrphanedSessions(): Promise<OrphanReconcileSummary> {
    return reconcileOrphanedSessions({
      runRepo: this.runRepo,
      taskRepo: this.taskRepo,
      sessionMappingRepo: this.sessionMappingRepo,
      agentRepo: this.agentRepo,
      stateMachine: this.stateMachine,
      harnessAdapters: this.harnessAdapters,
      activeSessions: this.activeSessions,
      evidenceRepo: this.evidenceRepo,
      resolveRuntimeAgentForRun: (run: Run) => this.resolveRuntimeAgentForRun(run),
      createMcpServer: (runId: RunId) => this.createMcpServer(runId),
      closeMcpServer: (mcp: DispatcherMcpServer) => this.closeMcpServer(mcp),
      onSessionEnd: (runId: RunId, _sessionId: string, ok: boolean) => {
        void this.handleSessionEnd(runId, {
          exitReason: ok ? 'completed' : 'crashed',
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        })
      },
      now: () => this.now(),
    })
  }
}
