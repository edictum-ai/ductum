import {
  createId,
  type EvidenceId,
  type Run,
  type RunId,
} from '@ductum/core'
import { rm } from 'node:fs/promises'

import type { ApiContext } from './deps.js'
import { ConflictError } from './errors.js'
import { requireRun } from './operator-run-guards.js'

export interface CancelRunResult {
  run: Run
  cost: {
    tokensIn: number
    tokensOut: number
    usd: number
  }
  worktreePreserved: boolean
  cleanupAt: string | null
  evidenceId: EvidenceId
}

export async function cancelRun(
  context: ApiContext,
  runId: RunId,
  input: { reason: string; cleanupWorktree?: boolean },
): Promise<CancelRunResult> {
  const reason = input.reason.trim()
  const run = requireRun(context, runId)
  if (run.terminalState != null) {
    throw new ConflictError(`Run ${runId} is already ${run.terminalState}`)
  }
  if (run.stage === 'done') {
    throw new ConflictError(`Run ${runId} is already done`)
  }

  await context.killRun?.(runId, 'cancelled')

  const cleanupAt = input.cleanupWorktree === true ? context.now().toISOString() : null
  if (cleanupAt != null) await cleanupWorktrees(context, run)
  const worktreePreserved = cleanupAt == null
  const cancelledAt = context.now().toISOString()

  const result = context.db.transaction(() => {
    context.stateMachine.markCancelled(runId, reason)
    if (!worktreePreserved) context.repos.runs.updateWorktreePaths(runId, null)
    const current = requireRun(context, runId)
    const evidence = context.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: {
        kind: 'operator.cancel',
        reason,
        worktreePreserved,
        cleanupAt,
        timestamp: cancelledAt,
      },
    })
    context.repos.runUpdates.create(runId, `operator cancelled run: ${reason}`)
    context.dag.onRunComplete(runId)
    return {
      run: requireRun(context, runId),
      cost: {
        tokensIn: current.tokensIn,
        tokensOut: current.tokensOut,
        usd: Number(current.costUsd.toFixed(4)),
      },
      worktreePreserved,
      cleanupAt,
      evidenceId: evidence.id,
    }
  })()

  context.enforcement.disposeRuntime(runId)
  context.events.emit({ type: 'run.cancelled', runId, reason, worktreePreserved, cleanupAt })
  return result
}

async function cleanupWorktrees(context: ApiContext, run: Run): Promise<void> {
  if (context.cleanupRunWorktrees != null) {
    await context.cleanupRunWorktrees(run.id)
    return
  }
  for (const path of run.worktreePaths ?? []) {
    await rm(path, { recursive: true, force: true })
  }
}
