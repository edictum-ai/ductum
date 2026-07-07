import {
  createId,
  type EvidenceId,
  type OrphanWorkerCleanupResult,
  type Run,
  type RunId,
} from '@ductum/core'
import { execFile } from 'node:child_process'
import { readdir, rm, rmdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
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
  /**
   * #275: outcome of process-tree cleanup. `method` is 'active-session'
   * when the dispatcher had a live session, 'active-session-failed'
   * when the live-session kill failed, 'orphan-fallback' when the
   * dispatcher had no session but the orphan-worker reaper acted, or
   * 'none' when neither path applied (e.g. mapping already removed).
   * `orphan` carries the raw OrphanWorkerCleanupResult for the orphan path.
   */
  processCleanup: {
    method: 'active-session' | 'active-session-failed' | 'orphan-fallback' | 'none'
    orphan: OrphanWorkerCleanupResult | null
  }
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

  // #275: cancel must terminate the attempt process tree or surface a
  // concrete cleanup failure. Try the active dispatcher session first;
  // when no session is bound (e.g. dispatcher was restarted between
  // dispatch and cancel), fall back to the orphan-worker reaper so we
  // do not leave a child process tree behind.
  const hadActiveSession = context.hasActiveSession?.(runId) === true
  let activeKillError: unknown = null
  try {
    await context.killRun?.(runId, 'cancelled')
  } catch (error) {
    activeKillError = error
  }
  let orphanResult: OrphanWorkerCleanupResult | null = null
  if (activeKillError != null) {
    orphanResult = {
      attempted: true,
      outcome: 'failed',
      reason: activeKillError instanceof Error ? activeKillError.message : String(activeKillError),
      pid: null,
      ownershipKind: null,
      startedAt: null,
    }
  } else if (!hadActiveSession) {
    try {
      orphanResult = await context.cleanupOrphanWorker?.(runId) ?? null
    } catch (error) {
      orphanResult = {
        attempted: true,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        pid: null,
        ownershipKind: null,
        startedAt: null,
      }
    }
  }
  const processCleanup: CancelRunResult['processCleanup'] = activeKillError != null
    ? { method: 'active-session-failed', orphan: orphanResult }
    : hadActiveSession
    ? { method: 'active-session', orphan: null }
    : orphanResult == null
      ? { method: 'none', orphan: null }
      : { method: 'orphan-fallback', orphan: orphanResult }

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
        processCleanup,
        timestamp: cancelledAt,
      },
    })
    // #275: when the orphan reaper attempted but did not clean the
    // process tree, record a separate evidence row so the failure is
    // visible to operators. The cancel still succeeds at the
    // state-machine level, but the orphan process needs follow-up.
    if ((processCleanup.method === 'orphan-fallback' || processCleanup.method === 'active-session-failed') && orphanResult?.outcome === 'failed') {
      context.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId,
        type: 'custom',
        payload: {
          kind: 'operator.cancel.process-cleanup-failed',
          reason: orphanResult.reason,
          pid: orphanResult.pid,
          ownershipKind: orphanResult.ownershipKind,
          timestamp: cancelledAt,
        },
      })
      context.repos.runUpdates.create(
        runId,
        `process cleanup failed: ${orphanResult.reason} (pid=${orphanResult.pid ?? 'unknown'})`,
      )
    }
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
      processCleanup,
    }
  })()

  context.enforcement.disposeRuntime(runId)
  context.events.emit({
    type: 'run.cancelled',
    runId,
    reason,
    worktreePreserved,
    cleanupAt,
    processCleanup: result.processCleanup,
  })
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
  await cleanupGeneratedCodexHomes(run.id, paths, context.runtime.worktreeBasePath ?? null)
}

async function cleanupGeneratedCodexHomes(
  runId: RunId,
  worktreePaths: readonly string[],
  worktreeBasePath: string | null,
): Promise<void> {
  const runSegment = safePathSegment(runId)
  const parents = new Set(worktreePaths.map((path) => dirname(path)))
  for (const parent of parents) {
    const codexHomeRoot = join(parent, '.codex-home')
    await rm(join(codexHomeRoot, runSegment), { recursive: true, force: true }).catch(() => undefined)
    await removeIfEmpty(codexHomeRoot)
    if (isGeneratedAttemptDir(runId, parent, worktreeBasePath)) await removeIfEmpty(parent)
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

function isGeneratedAttemptDir(runId: RunId, attemptDir: string, worktreeBasePath: string | null): boolean {
  const base = worktreeBasePath?.trim()
  if (base == null || base === '') return false

  const relativeAttemptDir = relative(resolve(base), resolve(attemptDir))
  if (relativeAttemptDir === '' || isAbsolute(relativeAttemptDir)) return false

  const segments = relativeAttemptDir.split(/[\\/]+/).filter(Boolean)
  const taskDir = segments[1]
  return segments.length === 2 && segments[0] !== '..' && taskDir != null && taskDir.endsWith(`-${runId.slice(0, 6)}`)
}
