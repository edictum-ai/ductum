/**
 * Internal budget controls for the cap-as-gate model.
 *
 * Decision 114: a perRunHardUsd or perSpecHardUsd projection crossing
 * pauses the run with a `cost_budget_paused` failReason rather than
 * silently abandoning it. Recovery records either add to the *task*'s
 * `budgetExtraUsd` and route the task back through the dispatcher, or
 * relabel the failReason to `cost_budget_denied` and pin the worktree
 * for operator inspection.
 */

import { log, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { addEvidence } from './evidence.js'

export interface BudgetExtendInput {
  runId: RunId
  byUsd: number
  reason?: string | null
  decidedBy?: string
}

export interface BudgetDenyInput {
  runId: RunId
  reason: string
  decidedBy?: string
}

export interface BudgetControlResult {
  ok: true
  runId: RunId
  taskId: string
  /** New per-task budgetExtraUsd after the operation (extend only). */
  budgetExtraUsd?: number
  /** Failure reason after the operation. */
  failReason: string | null
}

const PAUSED_FAILREASON_PREFIXES = ['cost_budget_paused', 'spec_cost_budget_paused'] as const

function isPaused(reason: string | null): boolean {
  if (reason == null) return false
  return PAUSED_FAILREASON_PREFIXES.some((prefix) => reason.startsWith(prefix))
}

export function isBudgetPaused(failReason: string | null): boolean {
  return isPaused(failReason)
}

export function isBudgetDenied(failReason: string | null): boolean {
  return failReason != null && failReason.startsWith('cost_budget_denied')
}

export function extendBudget(context: ApiContext, input: BudgetExtendInput): BudgetControlResult {
  if (!Number.isFinite(input.byUsd) || input.byUsd <= 0) {
    throw new ValidationError('budget.extend: --by must be a positive USD value')
  }
  const run = context.repos.runs.get(input.runId)
  if (run == null) throw new ValidationError(`Run not found: ${input.runId}`)
  if (!isPaused(run.failReason)) {
    throw new ValidationError(
      `Run ${input.runId.slice(0, 8)} is not paused on a cost budget (failReason: ${run.failReason ?? 'null'})`,
    )
  }

  const updatedTask = context.repos.tasks.incrementBudgetExtra(run.taskId, input.byUsd)

  // Resume the task: same recovery shape as `ductum retry`.
  context.repos.tasks.updateRetry(updatedTask.id, 0, null)
  context.repos.tasks.updateStatus(updatedTask.id, 'ready')
  context.dag.evaluateTaskDAG(updatedTask.specId)

  addEvidence(context, run.id, 'custom', {
    kind: 'operator-note',
    note: `Budget extended by $${input.byUsd.toFixed(2)} (task budgetExtraUsd: $${updatedTask.budgetExtraUsd.toFixed(2)}). ${input.reason ?? ''}`.trim(),
    operation: 'budget.extend',
    by_usd: input.byUsd,
    new_budget_extra_usd: updatedTask.budgetExtraUsd,
    decided_by: input.decidedBy ?? 'operator',
    reason: input.reason ?? null,
  })

  context.repos.runUpdates.create(
    run.id,
    `operator extended budget by $${input.byUsd.toFixed(2)} — task back in ready queue`,
  )

  log.info(
    'budget',
    `run ${run.id.slice(0, 8)} extended +$${input.byUsd.toFixed(2)} ` +
      `(task ${updatedTask.id.slice(0, 8)} budgetExtraUsd now $${updatedTask.budgetExtraUsd.toFixed(2)})`,
  )

  context.events.emit({
    type: 'cost_budget.extended',
    runId: run.id,
    byUsd: input.byUsd,
    newCap: (context.costBudget.perRunHardUsd ?? 0) + updatedTask.budgetExtraUsd,
  })

  return {
    ok: true,
    runId: run.id,
    taskId: updatedTask.id,
    budgetExtraUsd: updatedTask.budgetExtraUsd,
    failReason: run.failReason,
  }
}

export function denyBudget(context: ApiContext, input: BudgetDenyInput): BudgetControlResult {
  const trimmed = input.reason.trim()
  if (trimmed === '') {
    throw new ValidationError('budget.deny: --reason is required')
  }
  const run = context.repos.runs.get(input.runId)
  if (run == null) throw new ValidationError(`Run not found: ${input.runId}`)
  if (!isPaused(run.failReason)) {
    throw new ValidationError(
      `Run ${input.runId.slice(0, 8)} is not paused on a cost budget (failReason: ${run.failReason ?? 'null'})`,
    )
  }

  const newReason = `cost_budget_denied: ${trimmed}`
  context.repos.runs.updateFailure(run.id, newReason, false)

  addEvidence(context, run.id, 'custom', {
    kind: 'operator-note',
    note: `Budget extension denied. ${trimmed}`,
    operation: 'budget.deny',
    decided_by: input.decidedBy ?? 'operator',
    reason: trimmed,
    previous_failreason: run.failReason,
  })

  context.repos.runUpdates.create(
    run.id,
    `operator denied budget extension: ${trimmed}`,
  )

  log.info('budget', `run ${run.id.slice(0, 8)} budget denied — failReason: ${newReason}`)

  context.events.emit({
    type: 'run.budget_denied',
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
