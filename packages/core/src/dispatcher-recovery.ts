import { existsSync } from 'node:fs'

import { DispatcherSpawn } from './dispatcher-spawn.js'
import type { HarnessSessionResult } from './dispatcher-support.js'
import type { DispatchOptions } from './dispatcher-types.js'
import type { FencedDispatchWriteOptions } from './dispatcher-session.js'
import { releaseDispatchLease } from './dispatcher-lease.js'
import {
  DEFAULT_MAX_AUTO_WAIT_MS,
  classifyHarnessOutcome,
  resolveAutoWaitMs,
  type HarnessOutcome,
} from './dispatcher-limits.js'
import { log } from './logger.js'
import { buildCheckpointInput, isResumableCheckpoint } from './run-checkpoint.js'
import { createId, type Agent, type Run, type RunId, type Task } from './types.js'

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
    if (run.stage === 'done') throw new Error(`Run ${runId} is already done`)
    if (run.terminalState != null) {
      if (isResumableState(run)) return run
      throw new Error(`Run ${runId} is already ${run.terminalState}`)
    }

    const active = this.activeSessions.get(runId)
    const fenceOptions = { fenceToken: active?.lease?.fenceToken, fenceNow: this.now() }
    // Snapshot the checkpoint from the live state so resume can continue.
    const checkpoint = buildCheckpointInput(run)
    if (fenceOptions.fenceToken != null && this.runCheckpointRepo?.upsertFenced != null) {
      this.runCheckpointRepo.upsertFenced(checkpoint, fenceOptions.fenceToken, fenceOptions.fenceNow)
    } else {
      this.runCheckpointRepo?.upsert(checkpoint)
    }
    if (active != null) this.activeSessions.delete(runId)
    this.watcherManager.stopWatchers(runId, 'operator paused')
    this.stateMachine.markPaused(runId, reason, fenceOptions)
    this.recordRecoveryEvidence(runId, 'operator.pause', { reason }, fenceOptions)
    if (active != null) {
      await active.adapter.kill(active.session.sessionId, 'killed').catch(() => undefined)
      await this.releaseSession(active)
    }
    if (active != null) releaseDispatchLease(this.attemptLeaseRepo, active.lease, this.now())
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
    if (task.status === 'done') throw new Error(`Task ${task.id} is already done`)
    const active = this.runRepo.list(task.id).find((candidate) => candidate.id !== run.id && candidate.stage !== 'done' && candidate.terminalState == null)
    if (active != null) throw new Error(`Task ${task.id} already has an active run: ${active.id}`)
    const agent = this.matchResumeAgent(task, run)
    if (agent == null) throw new Error(`No agent available to resume run ${runId}`)

    const options = this.buildOperatorResumeOptions(run)
    const newRun = await this.dispatch(task, agent, options)
    this.eventEmitter.emit({ type: 'run.resumed', runId: newRun.id, fromRunId: runId, stage: newRun.stage })
    this.recordRecoveryEvidence(newRun.id, 'operator.resume', { fromRunId: runId, stage: newRun.stage })
    return newRun
  }

  protected async applyLimitsPolicy(
    run: Run,
    result: HarnessSessionResult,
    options: FencedDispatchWriteOptions = {},
  ): Promise<boolean> {
    const outcome = classifyHarnessOutcome(result)
    if (outcome.kind === 'terminal') return false

    if (outcome.kind === 'policy') {
      const prefix = result.exitReason === 'paused-cost-budget' ? 'cost_budget_paused' : 'max_turns_paused'
      this.freeze(run, formatPolicyPauseReason(prefix, outcome.detail, run.id), options)
      this.recordRecoveryEvidence(run.id, 'limits.policy', { action: 'freeze', ...outcomeFields(outcome) }, options)
      return true
    }

    const maxWaitMs = this.resolvedConfig.maxAutoWaitMs ?? DEFAULT_MAX_AUTO_WAIT_MS
    const waitMs = resolveAutoWaitMs(outcome, this.now().getTime(), maxWaitMs)

    if (outcome.kind === 'transient') {
      this.waitAndResume(run, waitMs, options)
      this.recordRecoveryEvidence(run.id, 'limits.transient', { action: waitMs != null ? 'wait-resume' : 'backoff-resume', waitMs, ...outcomeFields(outcome) }, options)
      return true
    }

    // recoverable-external: (a) wait if reset is near, (b) fail over, (c) freeze.
    if (waitMs != null) {
      this.waitAndResume(run, waitMs, options)
      this.recordRecoveryEvidence(run.id, 'limits.external', { action: 'wait-resume', waitMs, ...outcomeFields(outcome) }, options)
      return true
    }
    if (await this.failover(run, outcome, options)) return true
    this.freeze(run, `provider unavailable (no fallback): ${outcome.detail}`, options)
    this.recordRecoveryEvidence(run.id, 'limits.external', { action: 'freeze', ...outcomeFields(outcome) }, options)
    return true
  }

  /** Mark stalled and re-ready with a (possibly provider-supplied) backoff so
   *  the next cycle resumes from the checkpoint. */
  private waitAndResume(run: Run, waitMs: number | null, options: FencedDispatchWriteOptions): void {
    if (run.terminalState == null) this.stateMachine.markStalled(run.id, options)
    // Provider/transient backoff: force-transient so budget exhaustion here
    // never quarantines (design/04 §5 — keep provider/transient out of quarantine).
    this.retryOrFailStalledTask(run.id, 'crash', waitMs ?? undefined, { forceTransient: true })
  }

  private freeze(run: Run, reason: string, options: FencedDispatchWriteOptions): void {
    if (run.terminalState != null) return
    this.stateMachine.markFrozen(run.id, reason, options)
  }

  /** Re-dispatch the checkpointed run on a different-provider agent of the same
   *  role, continuing where it left off. Returns false when no fallback exists. */
  private async failover(run: Run, outcome: HarnessOutcome, options: FencedDispatchWriteOptions): Promise<boolean> {
    const failedAgent = this.resolveRuntimeAgentForRun(run) ?? this.agentRepo.get(run.agentId)
    const task = this.taskRepo.get(run.taskId)
    if (failedAgent == null || task == null) return false
    const nextRetryCount = task.retryCount + 1
    const maxRetries = this.resolvedConfig.maxTaskRetries
    if (nextRetryCount > maxRetries) {
      this.taskRepo.updateRetry(task.id, nextRetryCount, null)
      this.freeze(run, `provider unavailable (retry budget exhausted ${task.retryCount}/${maxRetries}): ${outcome.detail}`, options)
      this.recordRecoveryEvidence(run.id, 'limits.failover', { action: 'freeze', retryCount: nextRetryCount, maxRetries, ...outcomeFields(outcome) }, options)
      return true
    }

    const fallback = this.matchFailoverAgent(task, failedAgent)
    if (fallback == null) return false

    this.taskRepo.updateRetry(task.id, nextRetryCount, null)
    this.freeze(run, `recoverable_external: failover pending to ${fallback.name}`, options)
    const dispatchOptions = this.buildOperatorResumeOptions(this.runRepo.get(run.id) ?? run)
    try {
      const newRun = await this.dispatch(task, fallback, dispatchOptions)
      this.stateMachine.markFailed(run.id, `recoverable_external: failover to ${fallback.name}`, options)
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
      this.recordRecoveryEvidence(run.id, 'limits.failover', { action: 'dispatch-failed', toAgent: fallback.name, error: error instanceof Error ? error.message : String(error), ...outcomeFields(outcome) }, options)
      return true
    }
  }

  private matchResumeAgent(task: Task, run: Run): Agent | null {
    const source = this.resolveRuntimeAgentForRun(run) ?? this.agentRepo.get(run.agentId)
    if (source != null && shouldPreferDifferentProviderOnResume(run)) {
      const fallback = this.matchFailoverAgent(task, source)
      if (fallback != null) return fallback
    }
    if (source != null && this.isAgentAvailableForDispatch(source)) return source
    return this.matchAgent(task)
  }

  /** Worktree-reuse + resume-stage options for an operator/failover resume.
   *  Reuses the prior worktree when it still exists and can be seeded forward;
   *  otherwise a fresh run (best-effort continuation). */
  private buildOperatorResumeOptions(run: Run): DispatchOptions {
    const checkpoint = this.runCheckpointRepo?.get(run.id) ?? null
    if (!isResumableCheckpoint(checkpoint)) return {}
    const stage = checkpoint.stage
    const worktreePaths = checkpoint.worktreePaths ?? []
    const onDisk = worktreePaths.length > 0 && worktreePaths.every((p) => existsSync(p))
    const canSeed = stage === 'understand' || this.resolvedConfig.seedWorkflowStage != null
    if (run.stage === 'done' || !onDisk || !canSeed) return {}
    return { reuseWorktreeFromRunId: run.id, resumeFromStage: stage }
  }

  private recordRecoveryEvidence(
    runId: RunId,
    kind: string,
    payload: Record<string, unknown>,
    options: FencedDispatchWriteOptions = {},
  ): void {
    const evidence = {
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: { kind, ...payload },
    } as const
    if (options.fenceToken != null && this.evidenceRepo?.createFenced != null) {
      this.evidenceRepo.createFenced(evidence, options.fenceToken, options.fenceNow)
    } else {
      this.evidenceRepo?.create(evidence)
    }
  }
}

function outcomeFields(outcome: HarnessOutcome): Record<string, unknown> {
  return { kind: outcome.kind, detail: outcome.detail, retryAfterMs: outcome.retryAfterMs, resetAt: outcome.resetAt }
}

function formatPolicyPauseReason(prefix: 'cost_budget_paused' | 'max_turns_paused', detail: string, runId: RunId): string {
  const action = prefix === 'cost_budget_paused'
    ? 'adjust Factory Settings budgets or split the Task'
    : 'raise the turn limit or split the Task'
  return `${prefix}: ${detail}. Operator: inspect with ductum status ${runId}; ${action}, then ductum retry ${runId}.`
}

function shouldPreferDifferentProviderOnResume(run: Run): boolean {
  const reason = run.failReason ?? ''
  return run.terminalState === 'frozen' && /^(provider unavailable|recoverable_external)/.test(reason)
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
