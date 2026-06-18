import { type DispatcherMcpServer, type HarnessSessionResult } from './dispatcher-support.js'
import { closeStaleSlots } from './dispatcher-stale-slot-gc.js'
import { cleanupFailedOwnWorktrees } from './dispatcher-worktree-cleanup.js'
import { recordSessionCost } from './dispatcher-session-cost.js'
import { canResumeStalledRun, collectProtectedWorktreeShortIds } from './dispatcher-resume.js'
import {
  END_SESSION_FALLBACK_DELAY_MS,
  NON_STALLABLE_STAGES,
  type ActiveDispatchSession,
} from './dispatcher-types.js'
import { recordHarnessFailureEvidence } from './dispatcher-harness-failure.js'
import { DispatcherCycle } from './dispatcher-cycle.js'
import { log } from './logger.js'
import { classifyTask } from './post-completion-router.js'
import type { Run, RunId } from './types.js'

export abstract class DispatcherSession extends DispatcherCycle {
  async killRun(runId: RunId, reason: 'killed' | 'cancelled' = 'killed'): Promise<void> {
    const active = this.activeSessions.get(runId)
    if (active == null) return
    await active.adapter.kill(active.session.sessionId, reason).catch(() => undefined)
    this.activeSessions.delete(runId)
    await this.releaseSession(active)
    this.watcherManager.stopWatchers(runId, 'killed by operator')
  }

  async endSession(runId: RunId): Promise<void> {
    this.scheduleCompletionFallback(runId)
    const active = this.activeSessions.get(runId)
    if (active == null) return
    log.info('dispatcher', `endSession(${runId.slice(0, 8)}) — ductum.complete teardown`)
    await active.adapter.kill(active.session.sessionId, 'completed').catch((err) => {
      log.warn(
        'dispatcher',
        `endSession adapter.kill failed for ${runId}: ${err instanceof Error ? err.message : String(err)}`,
      )
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
    if (active != null) this.activeSessions.delete(runId)
    this.finishingRuns.add(runId)
    let completed = false
    let scheduledResume = false

    try {
      const run = this.runRepo.get(runId)
      if (run == null) return

      // D114/D118: paused-* exits are gate-evaluated, not stalled.
      if (exitReason === 'paused-max-turns' && run.terminalState == null) {
        const detail = result.pauseDetail?.detail ?? 'agent turn cap reached'
        this.stateMachine.markFailed(runId, 'max_turns_paused')
        this.runRepo.updateFailure(runId, `max_turns_paused: ${detail}. Operator: inspect with ductum status ${runId}; adjust Factory Settings or split the Task, then ductum retry ${runId}.`, true)
      } else if (exitReason === 'paused-cost-budget' && run.terminalState == null) {
        const detail = result.pauseDetail?.detail ?? 'SDK reported cost cap reached'
        this.stateMachine.markFailed(runId, 'cost_budget_paused')
        this.runRepo.updateFailure(runId, `cost_budget_paused: ${detail}. Operator: inspect with ductum status ${runId}; adjust Factory Settings budgets or split the Task, then ductum retry ${runId}.`, true)
      } else if ((exitReason === 'crashed' || exitReason === 'timeout') && !NON_STALLABLE_STAGES.has(run.stage) && run.terminalState == null) {
        this.stateMachine.markStalled(runId)
        if (result.failReason != null) this.recordAgentFailure(run, result.failReason)
        scheduledResume = this.retryOrFailStalledTask(runId, 'crash')
      } else if (exitReason === 'failed' && run.terminalState == null) {
        this.stateMachine.markFailed(runId, result.failReason ?? 'harness_failed')
        if (result.failReason === 'max_turns_reached') this.runRepo.updateFailure(runId, result.failReason, true)
        this.recordAgentFailure(run, result.failReason ?? 'harness_failed')
        recordHarnessFailureEvidence(this.evidenceRepo, runId, result)
      }

      const current = this.runRepo.get(runId)
      if (current == null) return
      recordSessionCost(
        { runRepo: this.runRepo, resolveScannerSnapshot: (id) => this.resolveScannerSnapshot(id), resolveRuntimeAgentForRun: (r) => this.resolveRuntimeAgentForRun(r) },
        runId, current, result, active,
      )

      if (exitReason === 'completed') {
        const task = this.taskRepo.get(current.taskId)
        if (task != null) {
          const kind = classifyTask(task).kind
          if (this.router.isBakeoffBlindReviewTask(task)) {
            await this.router.runBlindReviewCompletion(current)
          } else if (kind === 'review') {
            await this.router.runReviewCompletion(current)
          } else if (kind === 'fix') {
            await this.router.runFixCompletion(current)
          } else if (current.worktreePaths != null && current.worktreePaths.length > 0) {
            await this.router.runImplCompletion(current)
          }
        }
        this.routedPostCompletion.add(runId)
      }

      // Preserve the worktree when a resume is scheduled — the resumed
      // attempt rebinds it (design/04 §1). Otherwise clean it up as before.
      if (!scheduledResume) {
        await cleanupFailedOwnWorktrees(this.worktreeManager, current, result)
      }
      completed = true
    } finally {
      if (completed) this.handledSessionEnds.add(runId)
      if (completed) this.resolvedRunAgents.delete(runId)
      this.finishingRuns.delete(runId)
      if (active != null) await this.releaseSession(active)
    }
  }

  protected scheduleCompletionFallback(runId: RunId): void {
    if (this.routedPostCompletion.has(runId) || this.completionFallbacks.has(runId)) return
    const timer = setTimeout(() => {
      this.completionFallbacks.delete(runId)
      if (this.routedPostCompletion.has(runId)) return
      const run = this.runRepo.get(runId)
      if (run == null || run.terminalState != null || run.stage === 'done') return
      this.handledSessionEnds.delete(runId)
      log.warn(
        'dispatcher',
        `completion fallback fired for ${runId.slice(0, 8)} — forcing post-completion routing`,
      )
      void this.handleSessionEnd(runId, {
        exitReason: 'completed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
    }, END_SESSION_FALLBACK_DELAY_MS)
    this.completionFallbacks.set(runId, timer)
  }

  protected clearCompletionFallback(runId: RunId): void {
    const timer = this.completionFallbacks.get(runId)
    if (timer == null) return
    clearTimeout(timer)
    this.completionFallbacks.delete(runId)
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
          this.runRepo.updateHeartbeat(runId)
        }
      } catch (error) {
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
    if (closed.length > 0) log.warn('dispatcher', `auto-closed ${closed.length} stale slot(s)`)
    return closed.length
  }

  async cleanupStaleWorktrees(options: { force?: boolean } = {}): Promise<number> {
    if (this.worktreeManager == null) return 0
    try {
      // Preserve worktrees for active runs (incl. reused dirs), budget-paused
      // runs salvaged for the operator, and stalled runs awaiting resume from
      // a durable checkpoint (design/04 §1) — otherwise a force-clean could
      // delete a resumable worktree before the resume rebinds it.
      const protectedShortIds = collectProtectedWorktreeShortIds(this.runRepo, this.runCheckpointRepo)
      const removed = await this.worktreeManager.cleanupStale(protectedShortIds, options)
      if (removed > 0) {
        log.info('dispatcher', `cleaned up ${removed} stale worktree(s)${options.force ? ' (forced)' : ''}`)
      }
      return removed
    } catch (error) {
      log.warn('dispatcher', `stale worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      return 0
    }
  }

  /**
   * @returns true when a crash-retry was scheduled that will resume from a
   *   durable checkpoint (so the caller must preserve the worktree).
   */
  protected retryOrFailStalledTask(runId: RunId, cause: 'crash' | 'heartbeat'): boolean {
    const run = this.runRepo.get(runId)
    if (run == null) return false
    this.runRepo.updateFailure(run.id, run.failReason ?? 'stalled', true)

    const task = this.taskRepo.get(run.taskId)
    if (task == null) return false

    if (cause === 'heartbeat') {
      this.taskRepo.updateStatus(task.id, 'failed')
      this.dag.evaluateTaskDAG(task.specId)
      this.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'failed' })
      log.warn('dispatcher', `task ${task.name} (${task.id}) heartbeat-stalled — no auto-retry (P3 policy), marked failed`)
      return false
    }

    const { maxTaskRetries, retryBackoffScheduleMs } = this.resolvedConfig
    const nextRetryCount = task.retryCount + 1

    if (nextRetryCount > maxTaskRetries) {
      this.taskRepo.updateRetry(task.id, nextRetryCount, null)
      this.taskRepo.updateStatus(task.id, 'failed')
      this.dag.evaluateTaskDAG(task.specId)
      this.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'failed' })
      log.info('dispatcher', `task ${task.name} (${task.id}) exceeded max retries (${maxTaskRetries}), marked failed`)
      return false
    }

    const backoffMs = retryBackoffScheduleMs[nextRetryCount - 1]
      ?? retryBackoffScheduleMs[retryBackoffScheduleMs.length - 1]
      ?? 60_000
    const retryAfter = new Date(this.now().getTime() + backoffMs).toISOString()

    this.taskRepo.updateRetry(task.id, nextRetryCount, retryAfter)
    this.taskRepo.updateStatus(task.id, 'ready')
    this.dag.evaluateTaskDAG(task.specId)
    this.eventEmitter.emit({ type: 'task.status_changed', taskId: task.id, from: task.status, to: 'ready' })
    // When a resumable checkpoint exists, the next dispatch resumes from it
    // (design/04 §1): keep the worktree and re-enter at the checkpoint stage
    // rather than re-running the whole task from `understand`.
    const resuming = canResumeStalledRun(
      this.runCheckpointRepo,
      run,
      this.resolvedConfig.seedWorkflowStage != null,
    )
    log.info(
      'dispatcher',
      `task ${task.name} (${task.id}) crash-retry ${nextRetryCount}/${maxTaskRetries}` +
      `${resuming ? ' (resume from checkpoint)' : ''}, next attempt after ${retryAfter} (backoff ${backoffMs}ms)`,
    )
    return resuming
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

  protected async releaseSession(active: Pick<ActiveDispatchSession, 'mcpServer' | 'released'>): Promise<void> {
    if (active.released) return
    active.released = true
    await this.closeMcpServer(active.mcpServer)
  }

  protected async closeMcpServer(mcpServer: DispatcherMcpServer): Promise<void> {
    await mcpServer.close?.()
  }
}
