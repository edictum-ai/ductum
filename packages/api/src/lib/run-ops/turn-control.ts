/**
 * Internal turn-extension controls for the max-turns-as-gate model.
 * Decision 118 — same shape as Decision 114's budget gate but for
 * Claude Agent SDK's per-session turn cap.
 *
 * When `claude.ts` reports `error_max_turns`, the harness emits
 * `exitReason: 'paused-max-turns'`, the dispatcher sets a
 * `max_turns_paused` failReason, and the worktree is preserved on
 * disk. Recovery records either add to the *task*'s `turnExtraCount`
 * and route the task back through the dispatcher under a higher cap,
 * or relabel the failReason to `max_turns_denied` and pin the worktree.
 */

import { log, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { addEvidence } from './evidence.js'

export interface TurnExtendInput {
  runId: RunId
  byCount: number
  reason?: string | null
  decidedBy?: string
}

export interface TurnDenyInput {
  runId: RunId
  reason: string
  decidedBy?: string
}

export interface TurnControlResult {
  ok: true
  runId: RunId
  taskId: string
  /** New per-task turnExtraCount after the operation (extend only). */
  turnExtraCount?: number
  /** Failure reason after the operation. */
  failReason: string | null
}

const PAUSED_PREFIX = 'max_turns_paused'
const REACHED_PREFIX = 'max_turns_reached'

export function isMaxTurnsPaused(failReason: string | null): boolean {
  return failReason != null && failReason.startsWith(PAUSED_PREFIX)
}

export function isMaxTurnsRecoverable(failReason: string | null): boolean {
  return failReason != null && (failReason.startsWith(PAUSED_PREFIX) || failReason.startsWith(REACHED_PREFIX))
}

export function isMaxTurnsDenied(failReason: string | null): boolean {
  return failReason != null && failReason.startsWith('max_turns_denied')
}

export function extendTurns(context: ApiContext, input: TurnExtendInput): TurnControlResult {
  if (!Number.isInteger(input.byCount) || input.byCount <= 0) {
    throw new ValidationError('turns.extend: --by must be a positive integer turn count')
  }
  const run = context.repos.runs.get(input.runId)
  if (run == null) throw new ValidationError(`Run not found: ${input.runId}`)
  if (!isMaxTurnsRecoverable(run.failReason)) {
    throw new ValidationError(
      `Run ${input.runId.slice(0, 8)} is not recoverable on max_turns (failReason: ${run.failReason ?? 'null'})`,
    )
  }

  const updatedTask = context.repos.tasks.incrementTurnExtra(run.taskId, input.byCount)

  context.repos.tasks.updateRetry(updatedTask.id, 0, null)
  context.repos.tasks.updateStatus(updatedTask.id, 'ready')
  context.dag.evaluateTaskDAG(updatedTask.specId)

  addEvidence(context, run.id, 'custom', {
    kind: 'operator-note',
    note: `Turns extended by ${input.byCount} (task turnExtraCount: ${updatedTask.turnExtraCount}). ${input.reason ?? ''}`.trim(),
    operation: 'turns.extend',
    by_count: input.byCount,
    new_turn_extra_count: updatedTask.turnExtraCount,
    decided_by: input.decidedBy ?? 'operator',
    reason: input.reason ?? null,
  })

  context.repos.runUpdates.create(
    run.id,
    `operator extended turns by ${input.byCount} — task back in ready queue`,
  )

  log.info(
    'turns',
    `run ${run.id.slice(0, 8)} extended +${input.byCount} turns ` +
      `(task ${updatedTask.id.slice(0, 8)} turnExtraCount now ${updatedTask.turnExtraCount})`,
  )

  context.events.emit({
    type: 'run.turns_extended',
    runId: run.id,
    byCount: input.byCount,
    newTurnExtraCount: updatedTask.turnExtraCount,
  } as never)

  return {
    ok: true,
    runId: run.id,
    taskId: updatedTask.id,
    turnExtraCount: updatedTask.turnExtraCount,
    failReason: run.failReason,
  }
}

export function denyTurns(context: ApiContext, input: TurnDenyInput): TurnControlResult {
  const trimmed = input.reason.trim()
  if (trimmed === '') {
    throw new ValidationError('turns.deny: --reason is required')
  }
  const run = context.repos.runs.get(input.runId)
  if (run == null) throw new ValidationError(`Run not found: ${input.runId}`)
  if (!isMaxTurnsPaused(run.failReason)) {
    throw new ValidationError(
      `Run ${input.runId.slice(0, 8)} is not paused on max_turns (failReason: ${run.failReason ?? 'null'})`,
    )
  }

  const newReason = `max_turns_denied: ${trimmed}`
  context.repos.runs.updateFailure(run.id, newReason, false)

  addEvidence(context, run.id, 'custom', {
    kind: 'operator-note',
    note: `Turn extension denied. ${trimmed}`,
    operation: 'turns.deny',
    decided_by: input.decidedBy ?? 'operator',
    reason: trimmed,
    previous_failreason: run.failReason,
  })

  context.repos.runUpdates.create(
    run.id,
    `operator denied turn extension: ${trimmed}`,
  )

  log.info('turns', `run ${run.id.slice(0, 8)} turn extension denied — failReason: ${newReason}`)

  context.events.emit({
    type: 'run.turns_denied',
    runId: run.id,
    reason: trimmed,
  } as never)

  return {
    ok: true,
    runId: run.id,
    taskId: run.taskId,
    failReason: newReason,
  }
}
