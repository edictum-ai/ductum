import { existsSync } from 'node:fs'

import { DispatcherSpawn } from './dispatcher-spawn.js'
import type { HarnessSessionResult } from './dispatcher-support.js'
import type { DispatchOptions } from './dispatcher-types.js'
import {
  DEFAULT_MAX_AUTO_WAIT_MS,
  classifyHarnessOutcome,
  resolveAutoWaitMs,
  type HarnessOutcome,
} from './dispatcher-limits.js'
import { log } from './logger.js'
import { buildCheckpointInput, isResumableCheckpoint } from './run-checkpoint.js'
import { createId, type Agent, type Run, type RunId, type WorkflowStage } from './types.js'

/**
 * Operator pause/freeze + provider-limit recovery (design/04 §1, §5). All of
 * it is Ductum-owned (C4) — agents never self-pause, self-resume, or self-fail
 * over; these are dispatcher-driven, invoked by the operator or by the harness
 * session-end path.
 */
export abstract class DispatcherRecovery extends DispatcherSpawn {
  /** Operator pause: stop cleanly, snapshot a checkpoint, halt resumably. */
  async pause(runId: RunId, reason = 'operator paused'): Promise<Run> {
    const run = this.runRepo.get(runId)
    if (run == null) throw new Error(`Run not found: ${runId}`)
    if (run.terminalState != null) throw new Error(`Run ${runId} is already ${run.terminalState}`)
    if (run.stage === 'done') throw new Error(`Run ${runId} is already done`)

    // Snapshot the checkpoint from the live state so resume can continue.
    this.runCheckpointRepo?.upsert(buildCheckpointInput(run))
    const active = this.activeSessions.get(runId)
    if (active != null) {
      await active.adapter.kill(active.session.sessionId, 'killed').catch(() => undefined)
      this.activeSessions.delete(runId)
      await this.releaseSession(active)
    }
    this.watcherManager.stopWatchers(runId, 'operator paused')
    this.stateMachine.markPaused(runId, reason)
    this.recordRecoveryEvidence(runId, 'operator.pause', { reason })
    return this.runRepo.get(runId)!
  }

  /** Resume a halted run from its checkpoint on a NEW run reusing the worktree. */
  async resume(runId: RunId): Promise<Run> {
    const run = this.runRepo.get(runId)
    if (run == null) throw new Error(`Run not found: ${runId}`)
    if (!isResumableState(run)) {
      throw new Error(`Run ${runId} is not resumable (state: ${run.terminalState ?? 'active'})`)
    }
    const task = this.taskRepo.get(run.taskId)
    if (task == null) throw new Error(`Task not found for run ${runId}`)
    const agent = this.resolveRuntimeAgentForRun(run) ?? this.matchAgent(task)
    if (agent == null) throw new Error(`No agent available to resume run ${runId}`)

    const options = this.buildOperatorResumeOptions(run)
    const newRun = await this.dispatch(task, agent, options)
    this.eventEmitter.emit({ type: 'run.resumed', runId: newRun.id, fromRunId: runId, stage: newRun.stage })
    this.recordRecoveryEvidence(newRun.id, 'operator.resume', { fromRunId: runId, stage: newRun.stage })
    return newRun
  }

  protected async applyLimitsPolicy(run: Run, result: HarnessSessionResult): Promise<boolean> {
    const outcome = classifyHarnessOutcome(result)
    if (outcome.kind === 'terminal') return false

    if (outcome.kind === 'policy') {
      const prefix = result.exitReason === 'paused-cost-budget' ? 'cost_budget_paused' : 'max_turns_paused'
      this.freeze(run, `${prefix}: ${outcome.detail}`)
      this.recordRecoveryEvidence(run.id, 'limits.policy', { action: 'freeze', ...outcomeFields(outcome) })
      return true
    }

    const maxWaitMs = this.resolvedConfig.maxAutoWaitMs ?? DEFAULT_MAX_AUTO_WAIT_MS
    const waitMs = resolveAutoWaitMs(outcome, this.now().getTime(), maxWaitMs)

    if (outcome.kind === 'transient') {
      this.waitAndResume(run, waitMs)
      this.recordRecoveryEvidence(run.id, 'limits.transient', { action: waitMs != null ? 'wait-resume' : 'backoff-resume', waitMs, ...outcomeFields(outcome) })
      return true
    }

    // recoverable-external: (a) wait if reset is near, (b) fail over, (c) freeze.
    if (waitMs != null) {
      this.waitAndResume(run, waitMs)
      this.recordRecoveryEvidence(run.id, 'limits.external', { action: 'wait-resume', waitMs, ...outcomeFields(outcome) })
      return true
    }
    if (await this.failover(run, outcome)) return true
    this.freeze(run, `provider unavailable (no fallback): ${outcome.detail}`)
    this.recordRecoveryEvidence(run.id, 'limits.external', { action: 'freeze', ...outcomeFields(outcome) })
    return true
  }

  /** Mark stalled and re-ready with a (possibly provider-supplied) backoff so
   *  the next cycle resumes from the checkpoint. */
  private waitAndResume(run: Run, waitMs: number | null): void {
    if (run.terminalState == null) this.stateMachine.markStalled(run.id)
    this.retryOrFailStalledTask(run.id, 'crash', waitMs ?? undefined)
  }

  private freeze(run: Run, reason: string): void {
    if (run.terminalState != null) return
    this.stateMachine.markFrozen(run.id, reason)
  }

  /** Re-dispatch the checkpointed run on a different-provider agent of the same
   *  role, continuing where it left off. Returns false when no fallback exists. */
  private async failover(run: Run, outcome: HarnessOutcome): Promise<boolean> {
    const failedAgent = this.resolveRuntimeAgentForRun(run) ?? this.agentRepo.get(run.agentId)
    const task = this.taskRepo.get(run.taskId)
    if (failedAgent == null || task == null) return false
    const fallback = this.matchFailoverAgent(task, failedAgent)
    if (fallback == null) return false

    // The failed run must be terminal before a new run for the same task is
    // created; mark it failed (the failover continuation carries the work on).
    this.stateMachine.markFailed(run.id, `recoverable_external: failover to ${fallback.name}`)
    const options = this.buildOperatorResumeOptions(run)
    try {
      const newRun = await this.dispatch(task, fallback, options)
      this.eventEmitter.emit({
        type: 'run.failed_over',
        runId: newRun.id,
        fromRunId: run.id,
        fromAgentId: failedAgent.id,
        toAgentId: fallback.id,
        reason: outcome.detail,
      })
      this.recordRecoveryEvidence(newRun.id, 'limits.failover', {
        fromRunId: run.id,
        fromAgent: failedAgent.name,
        toAgent: fallback.name,
        ...outcomeFields(outcome),
      })
      return true
    } catch (error) {
      log.error('dispatcher', `failover dispatch failed for ${run.id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`)
      return true // the failed run is already terminal; surface as failed, do not double-handle
    }
  }

  /** Worktree-reuse + resume-stage options for an operator/failover resume.
   *  Reuses the prior worktree when it still exists and can be seeded forward;
   *  otherwise a fresh run (best-effort continuation). */
  private buildOperatorResumeOptions(run: Run): DispatchOptions {
    const checkpoint = this.runCheckpointRepo?.get(run.id) ?? null
    const stage: WorkflowStage = checkpoint?.stage ?? run.stage
    const worktreePaths = checkpoint?.worktreePaths ?? run.worktreePaths ?? []
    const onDisk = worktreePaths.length > 0 && worktreePaths.every((p) => existsSync(p))
    const canSeed = stage === 'understand' || this.resolvedConfig.seedWorkflowStage != null
    if (run.stage === 'done' || !onDisk || !canSeed) return {}
    return { reuseWorktreeFromRunId: run.id, resumeFromStage: stage }
  }

  private recordRecoveryEvidence(runId: RunId, kind: string, payload: Record<string, unknown>): void {
    this.evidenceRepo?.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: { kind, ...payload },
    })
  }
}

function outcomeFields(outcome: HarnessOutcome): Record<string, unknown> {
  return { kind: outcome.kind, detail: outcome.detail, retryAfterMs: outcome.retryAfterMs, resetAt: outcome.resetAt }
}

/** Halted-but-resumable: operator pause/freeze, crash-stall, or a recoverable
 *  budget/turn pause recorded as failed (unify existing pauses, design/04 §1). */
export function isResumableState(run: Run): boolean {
  if (run.stage === 'done') return false
  if (run.terminalState === 'paused' || run.terminalState === 'frozen' || run.terminalState === 'stalled') return true
  if (run.terminalState === 'failed' && run.recoverable) {
    const reason = run.failReason ?? ''
    return /^(cost_budget_paused|spec_cost_budget_paused|max_turns_paused)/.test(reason)
  }
  return false
}
