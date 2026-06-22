import {
  getDefaultCostScanner,
  log,
  type CostScanner,
  type RunId,
  type ScannedSessionTotals,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'

export function resolveScannerSnapshot(
  context: ApiContext,
  runId: RunId,
  scanner: CostScanner = getDefaultCostScanner(),
): ScannedSessionTotals | null {
  const mapping = context.repos.sessionRunMappings.getByRunId(runId)
  if (mapping == null || mapping.harnessSessionId == null || mapping.harnessSessionId === '') return null
  if (mapping.harness === 'codex-sdk' || mapping.harness === 'codex-app-server') {
    return scanner.getCodexSession(mapping.harnessSessionId)
  }
  if (mapping.harness === 'claude-agent-sdk') return scanner.getClaudeSession(mapping.harnessSessionId)
  return null
}

/**
 * Effective per-run hard cap for a given task. Decision 114:
 * `perRunHardUsd` is the global default. Per-task extensions are still
 * stored in `task.budgetExtraUsd`; public operator recovery now goes
 * through status, Factory Settings, and retry.
 */
function effectivePerRunHardUsd(
  context: ApiContext,
  taskId: RunId | string,
): number | null {
  if (context.costBudget.perRunHardUsd == null) return null
  const task = context.repos.tasks.get(taskId as never)
  const extra = task?.budgetExtraUsd ?? 0
  return context.costBudget.perRunHardUsd + extra
}

export async function precheckCostBudget(
  context: ApiContext,
  runId: RunId,
  projectedTotalUsd: number,
): Promise<boolean> {
  const budget = context.costBudget
  if (budget.perRunHardUsd == null && budget.perSpecHardUsd == null) return false

  const run = context.repos.runs.get(runId)
  if (run == null || run.terminalState != null) return false

  const runCap = effectivePerRunHardUsd(context, run.taskId)
  if (runCap != null && projectedTotalUsd >= runCap) {
    const extra = (context.repos.tasks.get(run.taskId)?.budgetExtraUsd ?? 0)
    const reason = formatPausedReason(projectedTotalUsd, runCap, budget.perRunHardUsd ?? 0, extra, 'run', runId)
    log.error('budget', `run ${runId.slice(0, 8)} ${reason} — pausing before write`)
    if (context.killRun != null) await context.killRun(runId).catch(() => undefined)
    context.stateMachine.markFrozen(runId, reason)
    emitBudgetPaused(context, runId, projectedTotalUsd, runCap, 'run')
    return true
  }

  if (budget.perSpecHardUsd != null) {
    const task = context.repos.tasks.get(run.taskId)
    if (task != null) {
      const tasksInSpec = context.repos.tasks.list(task.specId)
      let specCost = 0
      for (const t of tasksInSpec) {
        for (const r of context.repos.runs.list(t.id)) {
          specCost += r.id === runId ? projectedTotalUsd : r.costUsd
        }
      }
      if (specCost >= budget.perSpecHardUsd) {
        const reason = formatPausedReason(specCost, budget.perSpecHardUsd, budget.perSpecHardUsd, 0, 'spec', runId)
        log.error('budget', `spec ${task.specId.slice(0, 8)} ${reason} — pausing run ${runId.slice(0, 8)} before write`)
        if (context.killRun != null) await context.killRun(runId).catch(() => undefined)
        context.stateMachine.markFrozen(runId, reason)
        emitBudgetPaused(context, runId, specCost, budget.perSpecHardUsd, 'spec')
        return true
      }
    }
  }

  return false
}

export async function enforceCostBudget(context: ApiContext, runId: RunId): Promise<boolean> {
  const budget = context.costBudget
  if (
    budget.perRunWarnUsd == null &&
    budget.perRunHardUsd == null &&
    budget.perSpecHardUsd == null
  ) return false

  const run = context.repos.runs.get(runId)
  if (run == null) return false

  if (budget.perRunWarnUsd != null && run.costUsd >= budget.perRunWarnUsd && !context.costBudgetWarned.has(runId)) {
    context.costBudgetWarned.add(runId)
    log.warn('budget', `run ${runId.slice(0, 8)} crossed perRunWarnUsd $${budget.perRunWarnUsd} ` + `(now $${run.costUsd.toFixed(4)})`)
    context.events.emit({ type: 'run.cost_warning', runId, costUsd: run.costUsd, threshold: budget.perRunWarnUsd })
  }

  const runCap = effectivePerRunHardUsd(context, run.taskId)
  if (runCap != null && run.costUsd >= runCap && run.terminalState == null) {
    const extra = (context.repos.tasks.get(run.taskId)?.budgetExtraUsd ?? 0)
    const reason = formatPausedReason(run.costUsd, runCap, budget.perRunHardUsd ?? 0, extra, 'run', runId)
    log.error('budget', `run ${runId.slice(0, 8)} hit run cap $${runCap} (now $${run.costUsd.toFixed(4)}) — pausing`)
    if (context.killRun != null) await context.killRun(runId).catch(() => undefined)
    context.stateMachine.markFrozen(runId, reason)
    emitBudgetPaused(context, runId, run.costUsd, runCap, 'run')
    return true
  }

  if (budget.perSpecHardUsd != null) {
    const task = context.repos.tasks.get(run.taskId)
    if (task != null) {
      const tasksInSpec = context.repos.tasks.list(task.specId)
      let specCost = 0
      for (const t of tasksInSpec) {
        for (const r of context.repos.runs.list(t.id)) specCost += r.costUsd
      }
      if (specCost >= budget.perSpecHardUsd && run.terminalState == null) {
        const reason = formatPausedReason(specCost, budget.perSpecHardUsd, budget.perSpecHardUsd, 0, 'spec', runId)
        log.error('budget', `spec ${task.specId.slice(0, 8)} hit perSpecHardUsd $${budget.perSpecHardUsd} (now $${specCost.toFixed(4)}) — pausing run ${runId.slice(0, 8)}`)
        if (context.killRun != null) await context.killRun(runId).catch(() => undefined)
        context.stateMachine.markFrozen(runId, reason)
        emitBudgetPaused(context, runId, specCost, budget.perSpecHardUsd, 'spec')
        return true
      }
    }
  }

  return false
}

function formatPausedReason(
  current: number,
  cap: number,
  baseCap: number,
  extra: number,
  scope: 'run' | 'spec',
  runId: RunId,
): string {
  const prefix = scope === 'run' ? 'cost_budget_paused' : 'spec_cost_budget_paused'
  const breakdown = scope === 'run' && extra > 0
    ? ` (perRunHardUsd $${baseCap.toFixed(2)} + extra $${extra.toFixed(2)})`
    : ''
  return `${prefix}: $${current.toFixed(4)} >= $${cap.toFixed(2)}${breakdown}. Operator: inspect with ductum status ${runId}; adjust Factory Settings budgets or split the Task, then ductum retry ${runId}.`
}

function emitBudgetPaused(
  context: ApiContext,
  runId: RunId,
  currentUsd: number,
  capUsd: number,
  scope: 'run' | 'spec',
): void {
  context.events.emit({
    type: 'cost_budget.paused',
    runId,
    projectedSpend: currentUsd,
    cap: capUsd,
    scope,
  })
}
