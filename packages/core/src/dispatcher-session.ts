import { type DispatcherMcpServer, type HarnessSessionResult } from './dispatcher-support.js'
import { closeStaleSlots } from './dispatcher-stale-slot-gc.js'
import { cleanupFailedOwnWorktrees } from './dispatcher-worktree-cleanup.js'
import { isStaleFenceError, type FencingToken } from './attempt-lease.js'
import { releaseDispatchLease, renewDispatchLease } from './dispatcher-lease.js'
import { recordSessionCost } from './dispatcher-session-cost.js'
import { retryOrFailStalledTask, type RetryOrFailExtra } from './dispatcher-stalled-retry.js'
import { NON_STALLABLE_STAGES, type ActiveDispatchSession } from './dispatcher-types.js'
import { recordHarnessFailureEvidence } from './dispatcher-harness-failure.js'
import { DispatcherCycle } from './dispatcher-cycle.js'
import { releaseActiveDispatchSession } from './dispatcher-release-session.js'
import { forgetActive, releaseBeforeCompletionRouting, releaseLease, type CompletionReleaseState } from './dispatcher-completion-release.js'
import {
  clearCompletionFallbackForDispatcher,
  scheduleCompletionFallbackForDispatcher,
} from './dispatcher-completion-fallback.js'
import { routeCompletedRun } from './dispatcher-route-completion.js'
import { routeStoredCompletionForDispatcher } from './dispatcher-stored-completion.js'
import { log } from './logger.js'
import { cleanupPodmanContainersForRuns } from './podman-sandbox-driver.js'
import { cleanupStaleWorktreesForDispatcher } from './dispatcher-stale-worktree-cleanup.js'
import type { Run, RunId } from './types.js'

export interface FencedDispatchWriteOptions {
  fenceToken?: FencingToken
  fenceNow?: Date
}

export abstract class DispatcherSession extends DispatcherCycle {
  /** Provider-limit policy (design/04 §5), implemented by DispatcherRecovery.
   *  Returns true when handled (wait+resume / failover / freeze); false → fail. */
  protected abstract applyLimitsPolicy(run: Run, result: HarnessSessionResult, options?: FencedDispatchWriteOptions): Promise<boolean>

  async killRun(runId: RunId, reason: 'killed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.activeSessions.get(runId)
    if (active == null) return
    await active.adapter.kill(active.session.sessionId, reason).catch(() => undefined)
    this.activeSessions.delete(runId)
    releaseDispatchLease(this.attemptLeaseRepo, active.lease, this.now())
    await this.releaseSession(active)
    this.watcherManager.stopWatchers(runId, 'killed by operator')
  }

  async endSession(runId: RunId): Promise<void> {
    this.scheduleCompletionFallback(runId)
    const active = this.activeSessions.get(runId)
    if (active != null) {
      log.info('dispatcher', `endSession(${runId.slice(0, 8)}) — ductum.complete teardown`)
      void active.adapter.kill(active.session.sessionId, 'completed').catch((err) => log.warn(
        'dispatcher',
        `endSession adapter.kill failed for ${runId}: ${err instanceof Error ? err.message : String(err)}`,
      ))
    }
    if (this.routedPostCompletion.has(runId)) return
    this.handledSessionEnds.delete(runId)
    await this.handleSessionEnd(runId, { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
  }

  async routeStoredCompletion(runId: RunId): Promise<void> {
    await routeStoredCompletionForDispatcher({
      runId,
      runRepo: this.runRepo,
      taskRepo: this.taskRepo,
      router: this.router,
      routedPostCompletion: this.routedPostCompletion,
      handledSessionEnds: this.handledSessionEnds,
      finishingRuns: this.finishingRuns,
      requestFollowUpCycle: (reason) => this.requestFollowUpCycle(reason),
    })
  }

  hasActiveSession(runId: RunId): boolean {
    return this.activeSessions.has(runId)
  }

  protected async handleSessionEnd(runId: RunId, result: HarnessSessionResult): Promise<void> {
    if (this.handledSessionEnds.has(runId) || this.finishingRuns.has(runId)) return
    const completionRequested = this.completionFallbacks.has(runId)
    const exitReason = completionRequested ? 'completed' : result.exitReason
    if (completionRequested && result.exitReason !== 'completed') {
      log.warn('dispatcher', `completion teardown for ${runId.slice(0, 8)} reported ${result.exitReason}; treating as completed because ductum.complete was accepted`)
    }
    this.clearCompletionFallback(runId)
    const active = this.activeSessions.get(runId) ?? null
    this.finishingRuns.add(runId)
    let completed = false
    let scheduledResume = false
    let routedCompletion = false
    const releaseState: CompletionReleaseState = { releaseAttempted: false, activeRemoved: false, leaseReleased: false }

    try {
      const run = this.runRepo.get(runId)
      if (run == null) return
      const fenceOptions = { fenceToken: active?.lease?.fenceToken, fenceNow: this.now() }

      // D114/D118: budget/turn pauses → freeze+notify+resumable via the
      // limits policy (design/04 §5), not restart-from-scratch.
      if ((exitReason === 'paused-max-turns' || exitReason === 'paused-cost-budget') && run.terminalState == null) {
        await this.applyLimitsPolicy(run, result, fenceOptions)
      } else if ((exitReason === 'crashed' || exitReason === 'timeout') && !NON_STALLABLE_STAGES.has(run.stage) && run.terminalState == null) {
        this.stateMachine.markStalled(runId, fenceOptions)
        if (result.failReason != null) this.recordAgentFailure(run, result.failReason)
        // Thread the real crash reason so it is persisted to the run AND used
        // for deterministic-vs-transient quarantine classification. The in-
        // memory agent-health record alone is not durable enough to detect
        // recurrence. design/04 §5.
        scheduledResume = this.retryOrFailStalledTask(runId, 'crash', undefined, { failReason: result.failReason ?? undefined })
      } else if (exitReason === 'failed' && run.terminalState == null) {
        // Classify provider limits (transient / out-of-credits / terminal) and
        // act (wait+resume / failover / freeze). Unhandled → terminal fail.
        const handled = await this.applyLimitsPolicy(run, result, fenceOptions)
        if (!handled) {
          this.stateMachine.markFailed(runId, result.failReason ?? 'harness_failed', fenceOptions)
          if (result.failReason === 'max_turns_reached') this.runRepo.updateFailure(runId, result.failReason, true)
          this.recordAgentFailure(run, result.failReason ?? 'harness_failed')
          recordHarnessFailureEvidence(this.evidenceRepo, runId, result, fenceOptions.fenceToken, fenceOptions.fenceNow)
        }
      }

      const current = this.runRepo.get(runId)
      if (current == null) return
      recordSessionCost(
        { runRepo: this.runRepo, resolveScannerSnapshot: (id) => this.resolveScannerSnapshot(id), resolveRuntimeAgentForRun: (r) => this.resolveRuntimeAgentForRun(r) },
        runId, current, result, active, fenceOptions.fenceToken, fenceOptions.fenceNow,
      )

      if (exitReason === 'completed') {
        const releaseOk = await releaseBeforeCompletionRouting({
          active,
          runId,
          activeSessions: this.activeSessions,
          attemptLeaseRepo: this.attemptLeaseRepo,
          releaseSession: (session) => this.releaseSession(session),
          runRepo: this.runRepo,
          stateMachine: this.stateMachine,
          evidenceRepo: this.evidenceRepo,
          fenceOptions,
          now: () => this.now(),
        }, releaseState)
        if (!releaseOk) {
          completed = true
          return
        }
        await routeCompletedRun({ run: current, taskRepo: this.taskRepo, router: this.router })
        this.routedPostCompletion.add(runId)
        routedCompletion = true
      }

      // Preserve the worktree when a resume is scheduled (design/04 §1).
      if (!scheduledResume) await cleanupFailedOwnWorktrees(this.worktreeManager, current, result)
      completed = true
    } finally {
      if (completed) this.handledSessionEnds.add(runId)
      if (completed) this.resolvedRunAgents.delete(runId)
      this.finishingRuns.delete(runId)
      if (active != null) {
        forgetActive({ active, runId, activeSessions: this.activeSessions }, releaseState)
        releaseLease({ active, attemptLeaseRepo: this.attemptLeaseRepo, now: () => this.now() }, releaseState)
        if (!releaseState.releaseAttempted) await this.releaseSession(active)
      }
      if (completed && routedCompletion) this.requestFollowUpCycle(`completion ${runId.slice(0, 8)}`)
    }
  }

  private requestFollowUpCycle(reason: string): void {
    if (!this.running || !this.resolvedConfig.enabled) return
    log.info('dispatcher', `requesting follow-up cycle after ${reason}`)
    void this.tick()
  }

  protected scheduleCompletionFallback(runId: RunId): void {
    scheduleCompletionFallbackForDispatcher({
      runId,
      routedPostCompletion: this.routedPostCompletion,
      completionFallbacks: this.completionFallbacks,
      runRepo: this.runRepo,
      handledSessionEnds: this.handledSessionEnds,
      handleSessionEnd: (id, result) => this.handleSessionEnd(id, result),
    })
  }

  protected clearCompletionFallback(runId: RunId): void {
    clearCompletionFallbackForDispatcher(this.completionFallbacks, runId)
  }

  protected async checkStalled(): Promise<void> {
    await this.refreshLiveSessionHeartbeats()
    this.gcStaleSlots()
    const shouldSkip = (runId: RunId): boolean =>
      this.finishingRuns.has(runId) || !this.activeSessions.has(runId)
    for (const run of this.stateMachine.checkStalledRuns(shouldSkip)) {
      const active = this.activeSessions.get(run.id)
      if (active != null) {
        await active.adapter.kill(active.session.sessionId).catch(() => undefined)
        this.activeSessions.delete(run.id)
        releaseDispatchLease(this.attemptLeaseRepo, active.lease, this.now())
        await this.releaseSession(active)
      }
      this.watcherManager.stopWatchers(run.id, 'Run stalled')
      this.retryOrFailStalledTask(run.id, 'heartbeat')
    }
  }

  protected async refreshLiveSessionHeartbeats(): Promise<void> {
    for (const [runId, active] of this.activeSessions) {
      if (this.finishingRuns.has(runId)) continue
      try {
        if (await active.adapter.isAlive(active.session.sessionId)) {
          const run = this.runRepo.get(runId)
          if (run == null) continue
          active.lease = renewDispatchLease(
            this.attemptLeaseRepo,
            run,
            active.lease?.fenceToken,
            this.now(),
          )
          this.runRepo.updateHeartbeat(runId)
        }
      } catch (error) {
        if (isStaleFenceError(error)) {
          log.error('dispatcher', `stale lease rejected for ${runId.slice(0, 8)}: ${error.message}`)
          this.activeSessions.delete(runId)
          await active.adapter.kill(active.session.sessionId).catch(() => undefined)
          await this.releaseSession(active)
          continue
        }
        log.warn(
          'dispatcher',
          `isAlive failed for ${runId.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  protected gcStaleSlots(): number {
    const closed = closeStaleSlots({
      runRepo: this.runRepo,
      taskRepo: this.taskRepo,
      stateMachine: this.stateMachine,
      watcherManager: this.watcherManager,
      eventEmitter: this.eventEmitter,
      activeRunIds: new Set(this.activeSessions.keys()),
      finishingRunIds: new Set(this.finishingRuns),
      now: this.now(),
    })
    for (const runId of closed) this.retryOrFailStalledTask(runId, 'heartbeat')
    for (const runId of closed) this.attemptLeaseRepo?.expireRun(runId, this.now())
    const podmanCleanup = cleanupPodmanContainersForRuns(closed.filter((runId) => this.runRepo.get(runId)?.runtimeSandboxProfile?.provider === 'podman')); if (podmanCleanup.failed.length > 0 || podmanCleanup.listFailed.length > 0) log.warn('dispatcher', `podman stale cleanup failed for ${podmanCleanup.failed.length} container(s) and ${podmanCleanup.listFailed.length} run label scan(s)`)
    if (closed.length > 0) log.warn('dispatcher', `auto-closed ${closed.length} stale slot(s)`)
    return closed.length
  }

  async cleanupStaleWorktrees(options: { force?: boolean } = {}): Promise<number> {
    return cleanupStaleWorktreesForDispatcher(this.worktreeManager, this.runRepo, this.taskRepo, this.runCheckpointRepo, options)
  }

  /**
   * @returns true when a crash-retry was scheduled that will resume from a
   *   durable checkpoint (so the caller must preserve the worktree).
   */
  protected retryOrFailStalledTask(
    runId: RunId,
    cause: 'crash' | 'heartbeat',
    backoffMsOverride?: number,
    extra?: RetryOrFailExtra,
  ): boolean {
    return retryOrFailStalledTask(
      {
        runRepo: this.runRepo, taskRepo: this.taskRepo, dag: this.dag, eventEmitter: this.eventEmitter,
        runCheckpointRepo: this.runCheckpointRepo, stateMachine: this.stateMachine,
        maxTaskRetries: this.resolvedConfig.maxTaskRetries,
        retryBackoffScheduleMs: this.resolvedConfig.retryBackoffScheduleMs,
        canSeedWorkflowStage: this.resolvedConfig.seedWorkflowStage != null, now: () => this.now(),
      },
      runId, cause, backoffMsOverride, extra,
    )
  }

  protected async markDispatchStalled(run: Run, reason: string): Promise<void> {
    this.recordAgentFailure(run, reason)
    this.runRepo.updateFailure(run.id, reason, true)
    this.runRepo.updateTerminalState(run.id, 'stalled')
    this.eventEmitter.emit({ type: 'run.stage_changed', runId: run.id, from: run.stage, to: 'stalled', reason })
  }

  protected async createMcpServer(runId: RunId): Promise<DispatcherMcpServer> {
    if (this.resolvedConfig.createMcpServer == null) {
      throw new Error(`Dispatcher missing createMcpServer for run ${runId}`)
    }
    return await this.resolvedConfig.createMcpServer(runId)
  }

  protected async releaseSession(active: Pick<ActiveDispatchSession, 'mcpServer' | 'released' | 'sandboxRuntime'>): Promise<void> {
    await releaseActiveDispatchSession(active, (mcpServer) => this.closeMcpServer(mcpServer))
  }

  protected async closeMcpServer(mcpServer: DispatcherMcpServer): Promise<void> {
    await mcpServer.close?.()
  }
}
