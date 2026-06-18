import type { RunCheckpointRepo, RunRepo, RunStageHistoryRepo } from './repos/interfaces.js'
import type { Run, RunId, WorkflowStage } from './types.js'
import { DuctumEventEmitter } from './events.js'
import {
  applyTerminalState,
  assertFencedTerminalState,
  writeStageCheckpoint,
  type FencedWriteOptions,
} from './state-machine-fenced.js'

// Re-export so existing internal callers can import FencedWriteOptions from here.
export type { FencedWriteOptions } from './state-machine-fenced.js'

/**
 * Simplified RunStateMachine — Ductum only owns terminal states.
 *
 * Edictum's workflow runtime owns stage progression (D37, D43).
 * This machine handles: failed, stalled, done, heartbeat timeout, the
 * halted-but-resumable paused/frozen states, cancelled, and the distinct
 * quarantined poison state (design/04 §5).
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

  markFailed(runId: RunId, reason?: string, options: FencedWriteOptions = {}): Run {
    const run = this.requireRun(runId)
    applyTerminalState(this.runRepo, run.id, 'failed', options)
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

  markStalled(runId: RunId, options: FencedWriteOptions = {}): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot stall run that is already ${run.terminalState}`)
    }
    applyTerminalState(this.runRepo, run.id, 'stalled', options)
    this.recordTransition(run, run.stage, 'heartbeat timeout')
    return this.requireRun(runId)
  }

  markCancelled(runId: RunId, reason: string, options: FencedWriteOptions = {}): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot cancel run that is already ${run.terminalState}`)
    }
    if (run.stage === 'done') {
      throw new Error(`Cannot cancel run that is already done`)
    }
    applyTerminalState(this.runRepo, run.id, 'cancelled', options)
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
  markPaused(runId: RunId, reason: string, options: FencedWriteOptions = {}): Run {
    return this.haltResumable(runId, 'paused', reason, { type: 'run.paused', runId, reason }, options)
  }

  /**
   * System freeze (a human is genuinely needed: out-of-credits with no
   * fallback, a budget/turn hard stop, etc.). Halts into a resumable terminal
   * state and is surfaced for the operator; resumable on demand.
   */
  markFrozen(runId: RunId, reason: string, options: FencedWriteOptions = {}): Run {
    return this.haltResumable(runId, 'frozen', reason, { type: 'run.frozen', runId, reason }, options)
  }

  /**
   * Distinct poison terminal state (design/04 §5). Entered when a task's retry
   * budget exhausts on a deterministic, non-transient failure. Unlike the
   * other terminal markers, this WIDENS an already-terminal stalled/failed run
   * into `quarantined` — it never clobbers a resumable halt (paused/frozen),
   * a deliberate cancel, or a done run. recoverable=false: a poison task is
   * not auto-resumed; the operator decides. Ductum-owned (C4).
   */
  markQuarantined(runId: RunId, reason: string, options: FencedWriteOptions = {}): Run {
    const run = this.requireRun(runId)
    if (run.stage === 'done') {
      throw new Error(`Cannot quarantine run that is already done`)
    }
    // Quarantine only widens an already-terminal stalled/failed poison run. It
    // never clobbers a resumable halt (paused/frozen), a deliberate cancel, or
    // a still-active run (the dispatcher must mark it stalled/failed first).
    if (run.terminalState !== 'stalled' && run.terminalState !== 'failed') {
      throw new Error(`Cannot quarantine run that is ${run.terminalState ?? 'active'}`)
    }
    applyTerminalState(this.runRepo, run.id, 'quarantined', options)
    this.runRepo.updateWorkflowState(run.id, { blockedReason: null, pendingApproval: false })
    this.runRepo.updateFailure(run.id, reason, false)
    this.recordTransition(run, run.stage, `quarantined: ${reason}`)
    this.eventEmitter.emit({ type: 'run.quarantined', runId: run.id, reason })
    return this.requireRun(runId)
  }

  private haltResumable(
    runId: RunId,
    state: 'paused' | 'frozen',
    reason: string,
    event: { type: 'run.paused' | 'run.frozen'; runId: RunId; reason: string },
    options: FencedWriteOptions = {},
  ): Run {
    const run = this.requireRun(runId)
    if (run.terminalState != null) {
      throw new Error(`Cannot ${state} run that is already ${run.terminalState}`)
    }
    if (run.stage === 'done') {
      throw new Error(`Cannot ${state} run that is already done`)
    }
    applyTerminalState(this.runRepo, run.id, state, options)
    this.runRepo.updateWorkflowState(run.id, { blockedReason: null, pendingApproval: false })
    // recoverable=true: the run is resumable from its checkpoint.
    this.runRepo.updateFailure(run.id, reason, true)
    this.recordTransition(run, run.stage, `${state}: ${reason}`)
    this.eventEmitter.emit(event)
    return this.requireRun(runId)
  }

  markDone(runId: RunId, reason?: string, options: FencedWriteOptions = {}): Run {
    const run = this.requireRun(runId)
    assertFencedTerminalState(this.runRepo, run.id, run.terminalState, options)
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
  recordStageAdvance(runId: RunId, fromStage: string, toStage: string, reason?: string, options: FencedWriteOptions = {}): void {
    this.stageHistoryRepo.add({
      runId,
      fromStage,
      toStage,
      reason: reason ?? null,
    })
    writeStageCheckpoint(this.runCheckpointRepo, this.runRepo, runId, toStage as WorkflowStage, options)
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
  recordStageReset(runId: RunId, fromStage: string, toStage: string, reason?: string, options: FencedWriteOptions = {}): void {
    this.stageHistoryRepo.add({
      runId,
      fromStage,
      toStage,
      reason: reason ?? null,
    })
    writeStageCheckpoint(this.runCheckpointRepo, this.runRepo, runId, toStage as WorkflowStage, options)
    this.eventEmitter.emit({
      type: 'run.stage_changed',
      runId,
      from: fromStage,
      to: toStage,
      ...(reason == null ? {} : { reason }),
    })
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
