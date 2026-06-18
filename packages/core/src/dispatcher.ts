import { DispatcherRecovery } from './dispatcher-recovery.js'
import {
  reconcileOrphanedSessions,
  type OrphanReconcileSummary,
} from './dispatcher-reconcile.js'

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
  type SpawnOptions,
} from './dispatcher-support.js'
export type { AgentHealthState } from './dispatcher-agent-health.js'

// parseTaskName + PostCompletionRouter live in ./post-completion-router.js.
// Re-export parseTaskName for existing consumers that imported it from here.
export { parseTaskName } from './post-completion-router.js'

export class Dispatcher extends DispatcherRecovery {
  /**
   * Startup recovery is classification-first: active non-terminal runs
   * are judged from durable lease/checkpoint truth, then resumed,
   * stalled, or left alone with visible state-reconcile evidence.
   */
  async reconcileOrphanedSessions(): Promise<OrphanReconcileSummary> {
    return reconcileOrphanedSessions({
      runRepo: this.runRepo,
      taskRepo: this.taskRepo,
      sessionMappingRepo: this.sessionMappingRepo,
      agentRepo: this.agentRepo,
      stateMachine: this.stateMachine,
      activeSessions: this.activeSessions,
      evidenceRepo: this.evidenceRepo,
      attemptLeaseRepo: this.attemptLeaseRepo,
      runCheckpointRepo: this.runCheckpointRepo,
      canSeedWorkflowStage: this.resolvedConfig.seedWorkflowStage != null,
      resumeRun: (runId) => this.resume(runId),
      now: () => this.now(),
    })
  }
}
