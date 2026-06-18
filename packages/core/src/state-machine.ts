import type { RunCheckpointRepo, RunRepo, RunStageHistoryRepo } from './repos/interfaces.js'
import { buildCheckpointInput } from './run-checkpoint.js'
import type { Run, RunId, WorkflowStage } from './types.js'
import { DuctumEventEmitter } from './events.js'

/**
 * Simplified RunStateMachine — Ductum only owns terminal states.
 *
 * Edictum's workflow runtime owns stage progression (D37, D43).
 * This machine handles: failed, stalled, done, heartbeat timeout.
 */

export interface RunStateMachineOptions {
  now?: () => Date
  /**
   * Optional durable checkpoint store. When present, every forward stage
   * transition writes a RunCheckpoint mirroring the run's progress so a
   * crashed attempt can resume from its last stage (design/04 §1). Absent
   * → checkpointing is inert (shadow rollout, no behavior change).
   */
  runCheckpointRepo?: RunCheckpointRepo
}

export class RunStateMachine {
  private readonly now: () => Date
  private readonly runCheckpointRepo?: RunCheckpointRepo

  constructor(
    private readonly runRepo: RunRepo,
    private readonly stageHistoryRepo: RunStageHistoryRepo,
    private readonly eventEmitter: DuctumEventEmitter,
    options: RunStateMachineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.runCheckpointRepo = options.runCheckpointRepo
  }

  markFailed(runId: RunId, reason?: string): Run {
    const run = this.requireRun(runId)
    this.runRepo.updateTerminalState(run.id, 'failed')
    this.runRepo.updateWorkflowState(run.id, {
      blockedReason: null,
      pendingApproval: false,
    })
    this.runRepo.updateFailure(run.id, reason ?? 'run failed', false)
    this.recordTransition(run, run.stage, `failed: ${reason ?? 'run failed'}`)
    const updated = this.requireRun(runId)
    this.eventEmitter.emitRecord({
      type: 'run.failed',
      runId: run.id,
      failReason: updated.failReason,
    })
    return updated
  }

  markStalled(runId: RunId): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot stall run that is already ${run.terminalState}`)
    }
    this.runRepo.updateTerminalState(run.id, 'stalled')
    this.recordTransition(run, run.stage, 'heartbeat timeout')
    return this.requireRun(runId)
  }

  markCancelled(runId: RunId, reason: string): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot cancel run that is already ${run.terminalState}`)
    }
    if (run.stage === 'done') {
      throw new Error(`Cannot cancel run that is already done`)
    }
    this.runRepo.updateTerminalState(run.id, 'cancelled')
    this.runRepo.updateWorkflowState(run.id, {
      blockedReason: null,
      pendingApproval: false,
    })
    this.runRepo.updateFailure(run.id, null, false)
    this.recordTransition(run, run.stage, `cancelled: ${reason}`)
    return this.requireRun(runId)
  }

  /**
   * Operator pause (deliberate). Halts the run into a resumable terminal
   * state; the worktree + checkpoint are preserved by the caller so resume
   * continues from where it left off. Ductum-owned (C4) — agents never pause.
   */
  markPaused(runId: RunId, reason: string): Run {
    return this.haltResumable(runId, 'paused', reason, { type: 'run.paused', runId, reason })
  }

  /**
   * System freeze (a human is genuinely needed: out-of-credits with no
   * fallback, a budget/turn hard stop, etc.). Halts into a resumable terminal
   * state and is surfaced for the operator; resumable on demand.
   */
  markFrozen(runId: RunId, reason: string): Run {
    return this.haltResumable(runId, 'frozen', reason, { type: 'run.frozen', runId, reason })
  }

  private haltResumable(
    runId: RunId,
    state: 'paused' | 'frozen',
    reason: string,
    event: { type: 'run.paused' | 'run.frozen'; runId: RunId; reason: string },
  ): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot ${state} run that is already ${run.terminalState}`)
    }
    if (run.stage === 'done') {
      throw new Error(`Cannot ${state} run that is already done`)
    }
    this.runRepo.updateTerminalState(run.id, state)
    this.runRepo.updateWorkflowState(run.id, { blockedReason: null, pendingApproval: false })
    // recoverable=true: the run is resumable from its checkpoint.
    this.runRepo.updateFailure(run.id, reason, true)
    this.recordTransition(run, run.stage, `${state}: ${reason}`)
    this.eventEmitter.emit(event)
    return this.requireRun(runId)
  }

  markDone(runId: RunId, reason?: string): Run {
    const run = this.requireRun(runId)
    this.runRepo.updateStage(run.id, 'done')
    this.runRepo.updateTerminalState(run.id, null)
    this.runRepo.updateWorkflowState(run.id, {
      blockedReason: null,
      pendingApproval: false,
    })
    this.runRepo.updateFailure(run.id, null, true)
    this.stageHistoryRepo.add({
      runId: run.id,
      fromStage: run.stage,
      toStage: 'done',
      reason: reason ?? null,
    })
    this.eventEmitter.emit({
      type: 'run.stage_changed',
      runId: run.id,
      from: run.stage,
      to: 'done',
      ...(reason == null ? {} : { reason }),
    })
    const updated = this.requireRun(runId)
    this.eventEmitter.emitRecord({ type: 'run.completed', runId: run.id })
    return updated
  }

  /**
   * Record a workflow-driven stage change in history + events.
   * Called by enforce.ts when Edictum auto-advances the workflow.
   */
  recordStageAdvance(runId: RunId, fromStage: string, toStage: string, reason?: string): void {
    this.stageHistoryRepo.add({
      runId,
      fromStage,
      toStage,
      reason: reason ?? null,
    })
    this.writeCheckpoint(runId, toStage)
    this.eventEmitter.emit({
      type: 'run.stage_changed',
      runId,
      from: fromStage,
      to: toStage,
      ...(reason == null ? {} : { reason }),
    })
  }

  /**
   * Record a factory-owned workflow reset.
   *
   * This uses the same public stage_changed event shape as an advance, but
   * keeps reset call sites explicit so backward transitions are not recorded
   * through the workflow-advance path.
   */
  recordStageReset(runId: RunId, fromStage: string, toStage: string, reason?: string): void {
    this.stageHistoryRepo.add({
      runId,
      fromStage,
      toStage,
      reason: reason ?? null,
    })
    this.writeCheckpoint(runId, toStage)
    this.eventEmitter.emit({
      type: 'run.stage_changed',
      runId,
      from: fromStage,
      to: toStage,
      ...(reason == null ? {} : { reason }),
    })
  }

  /**
   * Upsert the durable RunCheckpoint to mirror a stage transition.
   * Skips terminal `done` (nothing to resume) and no-ops when no
   * checkpoint store is wired. Keeps the checkpoint stage consistent with
   * the run's real stage across both forward advances and resets.
   */
  private writeCheckpoint(runId: RunId, toStage: string): void {
    if (this.runCheckpointRepo == null || toStage === 'done') return
    const run = this.runRepo.get(runId)
    if (run == null || run.terminalState != null) return
    this.runCheckpointRepo.upsert(buildCheckpointInput(run, toStage as WorkflowStage))
  }

  clearTerminalState(runId: RunId): Run {
    const run = this.requireRun(runId)
    this.runRepo.updateTerminalState(run.id, null)
    return this.requireRun(runId)
  }

  heartbeat(runId: RunId): void {
    this.runRepo.updateHeartbeat(runId)
    this.eventEmitter.emit({ type: 'run.heartbeat', runId })
  }

  /**
   * Return runs whose heartbeat has expired and mark them stalled.
   *
   * Callers pass `shouldSkip` to exclude runs that should NOT be
   * considered for heartbeat-based stall detection — typically runs
   * that don't have a live harness session anymore (either in
   * post-completion or waiting for an async reviewer / fix). This
   * prevents the stall detector from killing runs that are legitimately
   * pending downstream work (see docs/analysis/2026-04-06 §P0).
   */
  checkStalledRuns(shouldSkip?: (runId: RunId) => boolean): Run[] {
    return this.runRepo
      .getActive()
      .filter((run) => run.terminalState == null)
      .filter((run) => shouldSkip == null || !shouldSkip(run.id))
      .filter((run) => this.isHeartbeatExpired(run))
      .map((run) => this.markStalled(run.id))
  }

  private recordTransition(run: Run, toStage: WorkflowStage, reason: string): void {
    this.stageHistoryRepo.add({
      runId: run.id,
      fromStage: run.stage,
      toStage,
      reason,
    })
    this.eventEmitter.emit({
      type: 'run.stage_changed',
      runId: run.id,
      from: run.stage,
      to: toStage,
      reason,
    })
  }

  private isHeartbeatExpired(run: Run): boolean {
    const reference = new Date(run.lastHeartbeat ?? run.createdAt)
    return reference.getTime() + run.heartbeatTimeoutSeconds * 1000 < this.now().getTime()
  }

  private requireRun(runId: RunId): Run {
    const run = this.runRepo.get(runId)
    if (run == null) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }
}
