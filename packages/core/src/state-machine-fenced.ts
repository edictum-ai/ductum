import type { RunCheckpointRepo, RunRepo } from './repos/interfaces.js'
import { buildCheckpointInput } from './run-checkpoint.js'
import type { FencingToken } from './attempt-lease.js'
import type { RunId, TerminalState, WorkflowStage } from './types.js'

/**
 * Fenced-write helpers extracted from RunStateMachine so that file stays under
 * the 300-LOC gate (design/04 §5 quarantine widened the terminal-state surface).
 * Each helper is a pure function over the durable repos and honors the
 * attempt-lease fencing token when the caller provides one: a stale owner whose
 * lease was superseded cannot finalize, checkpoint, or re-terminal a run a new
 * owner has taken over (design/04 §2). Pass `fenceToken` only on the four
 * recovery-critical write paths; leave it absent elsewhere (Scope Rule).
 */
export interface FencedWriteOptions {
  fenceToken?: FencingToken
  fenceNow?: Date
}

/**
 * Persist a terminal-state transition, fence-guarded when a token is supplied.
 * `terminalState` may be null (markDone clears it). Used by every terminal
 * marker on RunStateMachine.
 */
export function applyTerminalState(
  runRepo: RunRepo,
  runId: RunId,
  terminalState: TerminalState | null,
  options: FencedWriteOptions,
): void {
  if (options.fenceToken != null && runRepo.updateTerminalStateFenced != null) {
    runRepo.updateTerminalStateFenced(runId, terminalState, options.fenceToken, options.fenceNow)
  } else {
    runRepo.updateTerminalState(runId, terminalState)
  }
}

/**
 * Re-assert the existing terminal state under the current fence token so a
 * stale owner cannot complete `markDone` on a run a new owner took over. No-op
 * when no fencing is in use (local single-process path).
 */
export function assertFencedTerminalState(
  runRepo: RunRepo,
  runId: RunId,
  terminalState: TerminalState | null,
  options: FencedWriteOptions,
): void {
  if (options.fenceToken != null && runRepo.updateTerminalStateFenced != null) {
    runRepo.updateTerminalStateFenced(runId, terminalState, options.fenceToken, options.fenceNow)
  }
}

/**
 * Upsert the durable RunCheckpoint mirroring a stage transition. Skips
 * terminal `done` (nothing to resume) and no-ops when no checkpoint store is
 * wired (shadow rollout). Fence-guarded when a token is supplied.
 */
export function writeStageCheckpoint(
  runCheckpointRepo: RunCheckpointRepo | undefined,
  runRepo: RunRepo,
  runId: RunId,
  toStage: WorkflowStage,
  options: FencedWriteOptions,
): void {
  if (runCheckpointRepo == null || toStage === 'done') return
  const run = runRepo.get(runId)
  if (run == null || run.terminalState != null) return
  const checkpoint = buildCheckpointInput(run, toStage)
  if (options.fenceToken != null && runCheckpointRepo.upsertFenced != null) {
    runCheckpointRepo.upsertFenced(checkpoint, options.fenceToken, options.fenceNow)
  } else {
    runCheckpointRepo.upsert(checkpoint)
  }
}
