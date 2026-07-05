import type { DAGEvaluator } from './dag.js'
import {
  DEFAULT_DISPATCHER_CONFIG,
  type DispatchResult,
  type DispatcherConfig,
  type DispatcherMcpServer,
  type DispatcherStatus,
  type HarnessAdapter,
  type ResolvedDispatcherConfig,
} from './dispatcher-support.js'
import type { ActiveDispatchSession, DispatchOptions } from './dispatcher-types.js'
import { DuctumEventEmitter } from './events.js'
import { getDefaultCostScanner, type CostScanner } from './cost-scanner.js'
import {
  AGENT_FAILURE_THRESHOLD,
  AGENT_UNHEALTHY_COOLDOWN_MS,
  createAgentHealthRecord,
  hasAgentHealthRecordData,
  isRecoverableAgentFailure,
  pruneAgentHealthRecord,
  toAgentHealthState,
  type AgentHealthRecord,
  type AgentHealthState,
} from './dispatcher-agent-health.js'
import { refreshOpenRouterPricing } from './model-pricing.js'
import type { PostCompletionConfig } from './post-completion.js'
import { PostCompletionRouter } from './post-completion-router.js'
import { log } from './logger.js'
import type {
  AgentRepo,
  AttemptLeaseRepo,
  ConfigResourceRepo,
  EvidenceRepo,
  ProjectAgentRepo,
  ProjectRepo,
  RunCheckpointRepo,
  RunRepo,
  SessionRunMappingRepo,
  SpecRepo,
  TaskRepo,
} from './repos/interfaces.js'
import type { RunActivityRepo } from './repos/run-activity.js'
import type { TaskDispatchSkipRepo } from './repos/task-dispatch-skip.js'
import type { RunStateMachine } from './state-machine.js'
import type { TaskScopeRepos } from './task-scope.js'
import type { Agent, Run, RunId, Task } from './types.js'
import type { WatcherManager } from './watcher-manager.js'
import type { WorktreeManager } from './worktree.js'
import { createAttemptLeaseOwnerProcessId } from './attempt-lease.js'
import { InProcessQueue, type DispatchQueue } from './dispatch-queue.js'

export abstract class DispatcherBase {
  protected readonly resolvedConfig: ResolvedDispatcherConfig
  protected running = false
  protected readonly dispatchQueue: DispatchQueue = new InProcessQueue()
  protected lastCycleAt: string | null = null
  protected inFlightCycle: Promise<DispatchResult> | null = null
  protected pendingImmediateCycle = false
  protected cycleCount = 0
  protected readonly activeSessions = new Map<RunId, ActiveDispatchSession>()
  protected readonly startingRuns = new Set<RunId>()
  protected readonly resolvedRunAgents = new Map<RunId, Agent>()
  protected readonly lastLoggedErrors = new Map<string, string>()
  /** Last dispatch-skip reason emitted per task, so a ready task that keeps
   *  getting skipped (agent-busy / worktree-contention / retry-backoff) emits
   *  a task.dispatch_skipped event only when the reason changes, not every
   *  poll cycle. Cleared when the task dispatches. design/04 §6 legibility. */
  protected readonly lastSkipLogged = new Map<string, string>()
  protected readonly handledSessionEnds = new Set<RunId>()
  protected readonly routedPostCompletion = new Set<RunId>()
  protected readonly completionFallbacks = new Map<RunId, NodeJS.Timeout>()
  protected readonly agentHealth = new Map<Agent['id'], AgentHealthRecord>()
  protected forceCleanupOnNextCycle = false
  protected readonly finishingRuns = new Set<RunId>()
  protected readonly ownerProcessId = createAttemptLeaseOwnerProcessId()
  readonly router: PostCompletionRouter
  costScanner: CostScanner = getDefaultCostScanner()

  constructor(
    protected readonly dag: DAGEvaluator,
    protected readonly runRepo: RunRepo,
    protected readonly taskRepo: TaskRepo,
    protected readonly agentRepo: AgentRepo,
    protected readonly projectAgentRepo: ProjectAgentRepo,
    protected readonly specRepo: SpecRepo,
    protected readonly projectRepo: ProjectRepo,
    protected readonly stateMachine: RunStateMachine,
    protected readonly watcherManager: WatcherManager,
    protected readonly sessionMappingRepo: SessionRunMappingRepo,
    protected readonly harnessAdapters: Map<string, HarnessAdapter>,
    protected readonly eventEmitter: DuctumEventEmitter,
    config: DispatcherConfig = {},
    protected readonly worktreeManager?: WorktreeManager,
    protected readonly postCompletion?: PostCompletionConfig,
    protected readonly configResourceRepo?: ConfigResourceRepo,
    protected readonly evidenceRepo?: EvidenceRepo,
    protected readonly transaction?: <T>(fn: () => T) => T,
    protected readonly taskScopeRepos?: TaskScopeRepos,
    /**
     * Durable checkpoint store for crash recovery (design/04 §1). Optional
     * so existing construction sites keep working; resume is inert until
     * wired (shadow rollout).
     */
    protected readonly runCheckpointRepo?: RunCheckpointRepo,
    protected readonly attemptLeaseRepo?: AttemptLeaseRepo,
    protected readonly runActivityRepo?: RunActivityRepo,
    protected readonly taskDispatchSkipRepo?: TaskDispatchSkipRepo,
  ) {
    this.resolvedConfig = { ...DEFAULT_DISPATCHER_CONFIG, ...config }
    this.router = new PostCompletionRouter({
      runRepo,
      taskRepo,
      specRepo,
      projectRepo,
      evidenceRepo,
      stateMachine,
      eventEmitter,
      postCompletion,
      hasLiveSession: (runId) => this.activeSessions.has(runId),
      evaluateTaskDAG: (specId) => {
        this.dag.evaluateTaskDAG(specId)
      },
      transaction,
    })
  }

  start(): void {
    if (this.running || !this.resolvedConfig.enabled) return
    this.running = true
    this.dispatchQueue.start(() => {
      void this.tick()
    }, this.resolvedConfig.pollIntervalMs)
    this.forceCleanupOnNextCycle = true
    void refreshOpenRouterPricing().catch(() => undefined)
    void this.tick()
  }

  stop(): void {
    this.running = false
    this.dispatchQueue.stop()
  }

  status(): DispatcherStatus {
    return {
      running: this.running,
      activeRuns: this.activeSessions.size,
      maxConcurrentRuns: this.resolvedConfig.maxConcurrentRuns,
      lastCycleAt: this.lastCycleAt,
      enabled: this.resolvedConfig.enabled,
      adapterCount: this.harnessAdapters.size,
      adapters: [...this.harnessAdapters.keys()].sort(),
      reason:
        this.resolvedConfig.enabled
          ? null
          : this.resolvedConfig.disabledReason != null
            ? this.resolvedConfig.disabledReason
            : this.harnessAdapters.size === 0
              ? 'dispatch disabled: no harness adapters loaded'
              : 'dispatch disabled',
    }
  }

  runtimeConfig(): { heartbeatTimeoutSeconds: number; pollIntervalMs: number; attemptCeilings: ResolvedDispatcherConfig['attemptCeilings'] } {
    return {
      heartbeatTimeoutSeconds: this.resolvedConfig.heartbeatTimeoutSeconds,
      pollIntervalMs: this.resolvedConfig.pollIntervalMs,
      attemptCeilings: this.resolvedConfig.attemptCeilings,
    }
  }

  setHeartbeatTimeoutSeconds(seconds: number): void {
    this.resolvedConfig.heartbeatTimeoutSeconds = seconds
  }

  getAgentHealth(): AgentHealthState[] {
    return this.agentRepo.list().map((agent) => this.currentAgentHealthState(agent))
  }

  resetAgentHealth(nameOrId: string): boolean {
    const agent = this.agentRepo.get(nameOrId as Agent['id']) ?? this.agentRepo.getByName(nameOrId)
    if (agent == null) return false
    this.agentHealth.delete(agent.id)
    return true
  }

  protected now(): Date {
    return this.resolvedConfig.now?.() ?? new Date()
  }

  protected recordAgentFailure(run: Run, reason: string): void {
    if (!isRecoverableAgentFailure(reason)) return

    const agent = this.resolvedRunAgents.get(run.id) ?? this.agentRepo.get(run.agentId)
    const record = this.agentHealth.get(run.agentId) ?? createAgentHealthRecord()
    const nowMs = this.now().getTime()
    pruneAgentHealthRecord(record, nowMs)
    record.failures.push({ atMs: nowMs, reason })

    if (record.failures.length >= AGENT_FAILURE_THRESHOLD) {
      record.unhealthyUntilMs = nowMs + AGENT_UNHEALTHY_COOLDOWN_MS
      record.unhealthyReason = `${record.failures.length} recent failures: ${reason}`
      if (agent != null) {
        log.warn('dispatcher', `marked ${agent.name} unhealthy: ${record.failures.length} recent failures`)
      }
    }
    this.agentHealth.set(run.agentId, record)
  }

  protected shouldSkipUnhealthyAgent(agent: Agent): boolean {
    const state = this.currentAgentHealthState(agent)
    if (!state.unhealthy) return false
    log.warn('dispatcher', `skipping ${agent.name}: ${state.recentFailures} recent failures`)
    return true
  }

  private currentAgentHealthState(agent: Agent): AgentHealthState {
    const nowMs = this.now().getTime()
    const record = this.agentHealth.get(agent.id) ?? null
    if (record != null) {
      pruneAgentHealthRecord(record, nowMs)
      if (!hasAgentHealthRecordData(record)) this.agentHealth.delete(agent.id)
    }
    return toAgentHealthState(agent, record, nowMs)
  }

  protected abstract tick(): Promise<void>
  protected abstract dispatch(task: Task, agent: Agent, options?: DispatchOptions): Promise<Run>
  protected abstract resolveDispatchOptions(task: Task): DispatchOptions
  protected abstract checkStalled(): Promise<void>
  abstract cleanupStaleWorktrees(options?: { force?: boolean; strict?: boolean }): Promise<number>
  protected abstract markDispatchStalled(run: Run, reason: string): Promise<void>
  protected abstract createMcpServer(runId: RunId): Promise<DispatcherMcpServer>
}
