import {
  createId,
  type EvidenceId,
  type Run,
  type RunId,
} from '@ductum/core'
import { execFile } from 'node:child_process'
import { readdir, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import type { ApiContext } from './deps.js'
import { ConflictError } from './errors.js'
import { requireRun } from './operator-run-guards.js'

const execFileAsync = promisify(execFile)

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
  const dirtyWorktree = worktreePreserved ? await hasDirtyWorktree(run) : false
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
        dirtyWorktree,
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

async function hasDirtyWorktree(run: Run): Promise<boolean> {
  for (const path of run.worktreePaths ?? []) {
    try {
      const { stdout } = await execFileAsync('git', ['-C', path, 'status', '--porcelain'], {
        encoding: 'utf-8',
        timeout: 10_000,
      })
      if (stdout.trim() !== '') return true
    } catch {
      // Missing or invalid worktree paths are not treated as dirty.
    }
  }
  return false
}

async function cleanupWorktrees(context: ApiContext, run: Run): Promise<void> {
  const paths = run.worktreePaths ?? []
  if (context.cleanupRunWorktrees != null) {
    await context.cleanupRunWorktrees(run.id)
  } else {
    for (const path of paths) {
      await rm(path, { recursive: true, force: true })
    }
  }
  await cleanupGeneratedCodexHomes(run.id, paths)
}

async function cleanupGeneratedCodexHomes(runId: RunId, worktreePaths: readonly string[]): Promise<void> {
  const runSegment = safePathSegment(runId)
  const parents = new Set(worktreePaths.map((path) => dirname(path)))
  for (const parent of parents) {
    const codexHomeRoot = join(parent, '.codex-home')
    await rm(join(codexHomeRoot, runSegment), { recursive: true, force: true }).catch(() => undefined)
    await removeIfEmpty(codexHomeRoot)
    await removeIfEmpty(parent)
  }
}

async function removeIfEmpty(path: string): Promise<void> {
  const entries = await readdir(path).catch(() => null)
  if (entries != null && entries.length === 0) await rmdir(path).catch(() => undefined)
}

function safePathSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_')
  return segment.length > 0 ? segment : 'default'
}
