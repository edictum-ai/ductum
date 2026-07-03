import { log } from '../logger.js'
import { DUCTUM_WATCHER_EVIDENCE_PRODUCER, withTrustedEvidenceProducer } from '../evidence-provenance.js'
import type { EvidenceType, Run, RunId } from '../types.js'
import { createId } from '../types.js'
import type { WatcherConfig, WatcherDependencies, WatcherOptions } from '../watcher.js'
import { runGhCommand } from '../watcher.js'
import { requireMaterializedWorkflowProfile } from '../workflow-profile-runtime.js'

const WAITING_STAGES = new Set(['ship'])

export abstract class BaseWatcher {
  private timer: NodeJS.Timeout | null = null
  private started = false
  private startedAt = 0
  private stopped = false
  private settled = false
  readonly childRunId: RunId = createId<'RunId'>()

  constructor(
    protected readonly config: WatcherConfig,
    protected readonly deps: WatcherDependencies,
    private readonly options: WatcherOptions = {},
  ) {}

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.startedAt = this.now()
    this.createChildRun()
    void this.poll()
  }

  stop(reason: string = 'Watcher stopped'): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.clearTimer()
    if (!this.settled) {
      this.markChildDone(reason)
    }
  }

  /**
   * Cancel an unsettled watcher as bookkeeping instead of marking its child
   * `done`. Used when the parent run enters approval (or is already awaiting
   * approval) — the child placeholder has no session, no worktree, and no
   * completed stages, so it must not look like successful implementation
   * work. The placeholder keeps `stage: 'understand'` and gains
   * `terminalState: 'cancelled'` with the shutdown reason recorded as
   * `failReason`. Settled watchers (real CI/review resolution already
   * recorded) are left untouched — their `done` transition was earned.
   */
  cancel(reason: string = 'Watcher cancelled'): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.clearTimer()
    if (!this.settled) {
      this.cancelChildPlaceholder(reason)
    }
  }

  protected abstract pollOnce(): Promise<boolean>
  protected abstract resolveTimeout(): Promise<void>

  protected async runCommand(args: readonly string[]): Promise<string> {
    return (this.options.commandRunner ?? runGhCommand)(args)
  }

  protected now(): number {
    return (this.options.now ?? Date.now)()
  }

  protected finalize(reason: string): void {
    if (this.settled) {
      return
    }
    this.settled = true
    this.clearTimer()
    this.markChildDone(reason)
  }

  protected validateParent(
    latch: 'ci' | 'review',
    observedCommitSha?: string,
  ): { run: Run } | { reason: string } {
    const run = this.deps.runRepo.get(this.config.parentRunId)
    if (run == null) {
      return { reason: 'Parent run missing' }
    }
    if (run.commitSha !== this.config.commitSha && run.commitSha !== observedCommitSha) {
      return { reason: 'Stale commit SHA' }
    }
    if (!WAITING_STAGES.has(run.stage)) {
      return { reason: `Parent run no longer waiting (${run.stage})` }
    }
    const status = latch === 'ci' ? run.ciStatus : run.reviewStatus
    if (status === 'pass' || status === 'fail') {
      return { reason: `Duplicate ${latch} signal ignored` }
    }
    return { run }
  }

  protected attachEvidence(type: EvidenceType, payload: Record<string, unknown>): void {
    const evidence = this.deps.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId: this.config.parentRunId,
      type,
      payload: withTrustedEvidenceProducer(payload, DUCTUM_WATCHER_EVIDENCE_PRODUCER),
    })
    this.deps.eventEmitter.emit({
      type: 'run.evidence_attached',
      runId: this.config.parentRunId,
      evidenceId: evidence.id,
    })
  }

  protected resolvedAt(): string {
    return new Date(this.now()).toISOString()
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.settled) {
      return
    }
    if (this.now() - this.startedAt >= this.config.timeoutMs) {
      await this.resolveTimeout()
      return
    }
    try {
      const finished = await this.pollOnce()
      if (!finished && !this.stopped && !this.settled) {
        this.timer = setTimeout(() => void this.poll(), this.config.pollIntervalMs)
      }
    } catch (error) {
      log.warn('watcher', `${this.config.type} watcher poll failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!this.stopped && !this.settled) {
        this.timer = setTimeout(() => void this.poll(), this.config.pollIntervalMs)
      }
    }
  }

  private clearTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private createChildRun(): void {
    const parentRun = this.requireParentRun()
    const runtimeWorkflowProfile = parentRun.runtimeWorkflowProfile == null
      ? null
      : requireMaterializedWorkflowProfile(parentRun.runtimeWorkflowProfile)
    this.deps.runRepo.create({
      id: this.childRunId,
      taskId: parentRun.taskId,
      agentId: this.options.childAgentId ?? parentRun.agentId,
      parentRunId: parentRun.id,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: parentRun.branch,
      commitSha: this.config.commitSha,
      prNumber: parentRun.prNumber,
      prUrl: this.config.prUrl,
      worktreePaths: null,
      runtimeWorkflowProfile,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date(this.now()).toISOString(),
      heartbeatTimeoutSeconds: Math.max(60, Math.ceil(this.config.timeoutMs / 1000)),
    })
  }

  private markChildDone(reason: string): void {
    const childRun = this.deps.runRepo.get(this.childRunId)
    if (childRun == null || childRun.stage === 'done') {
      return
    }
    this.deps.runRepo.updateStage(this.childRunId, 'done', reason)
  }

  private cancelChildPlaceholder(reason: string): void {
    const childRun = this.deps.runRepo.get(this.childRunId)
    if (childRun == null) {
      return
    }
    if (childRun.terminalState != null) {
      return
    }
    this.deps.runRepo.updateTerminalState(this.childRunId, 'cancelled')
    this.deps.runRepo.updateFailure(this.childRunId, reason, false)
  }

  private requireParentRun(): Run {
    const parentRun = this.deps.runRepo.get(this.config.parentRunId)
    if (parentRun == null) {
      throw new Error(`Run not found: ${this.config.parentRunId}`)
    }
    return parentRun
  }
}
