import { existsSync } from 'node:fs'

import type { DispatchOptions } from './dispatcher-types.js'
import type { RunCheckpointRepo, RunRepo, TaskRepo } from './repos/interfaces.js'
import { isResumableCheckpoint, type RunCheckpoint } from './run-checkpoint.js'
import type { Run, Task, WorkflowStage } from './types.js'

/**
 * Checkpoint/resume helpers (design/04 §1). These are pure functions over
 * the durable checkpoint store so the dispatcher's recovery decisions are
 * derivable from durable state, not in-memory bookkeeping.
 */

/** A resume needs a seed hook unless it lands at the workflow's first stage. */
function resumeNeedsSeed(stage: WorkflowStage): boolean {
  return stage !== 'understand'
}

/**
 * Cleanliness probe (design/04 RISK 1): the checkpointed worktree must still
 * be on disk. If a stale-worktree GC removed it, resume is NOT viable and the
 * caller falls back to today's safe fresh-Run dispatch instead of trying to
 * rebind (and failing on) a missing worktree.
 */
function worktreeOnDisk(checkpoint: RunCheckpoint): boolean {
  const paths = checkpoint.worktreePaths ?? []
  return paths.length > 0 && paths.every((p) => existsSync(p))
}

/**
 * Can the crashed/stalled `run` be resumed from its own checkpoint? True only
 * when the checkpoint sits at a resumable stage with a worktree that still
 * exists on disk, and (for non-`understand` stages) a seed hook exists to set
 * the resumed run's Edictum workflow forward to that stage.
 */
export function canResumeStalledRun(
  checkpointRepo: RunCheckpointRepo | undefined,
  run: Run,
  hasSeedHook: boolean,
): boolean {
  const checkpoint = checkpointRepo?.get(run.id) ?? null
  if (!isResumableCheckpoint(checkpoint)) return false
  if (!worktreeOnDisk(checkpoint)) return false
  return !resumeNeedsSeed(checkpoint.stage) || hasSeedHook
}

/**
 * Resume dispatch options derived from a task's latest stalled checkpoint, or
 * null to fall back to today's fresh-Run dispatch. Reuses the prior worktree
 * (`reuseWorktreeFromRunId`) and resumes at the checkpoint stage.
 */
export function resolveResumeOptions(
  checkpointRepo: RunCheckpointRepo | undefined,
  task: Task,
  hasSeedHook: boolean,
): Pick<DispatchOptions, 'reuseWorktreeFromRunId' | 'resumeFromStage'> | null {
  const checkpoint = checkpointRepo?.getLatestStalledCheckpoint(task.id) ?? null
  if (!isResumableCheckpoint(checkpoint)) return null
  if (!worktreeOnDisk(checkpoint)) return null
  if (resumeNeedsSeed(checkpoint.stage) && !hasSeedHook) return null
  return { reuseWorktreeFromRunId: checkpoint.runId, resumeFromStage: checkpoint.stage }
}

/**
 * Resolve the initial run state for a (possibly resumed) dispatch. For a
 * resume it returns the checkpoint stage + restored completedStages so the new
 * run record starts where the crashed attempt left off; otherwise the default
 * fresh `understand` start.
 */
export function resolveDispatchStart(
  checkpointRepo: RunCheckpointRepo | undefined,
  options: DispatchOptions,
): { stage: WorkflowStage; completedStages: string[]; seedStage: WorkflowStage | null } {
  const resumeFromStage = options.resumeFromStage ?? null
  if (resumeFromStage == null || options.reuseWorktreeFromRunId == null) {
    return { stage: 'understand', completedStages: [], seedStage: null }
  }
  const checkpoint = checkpointRepo?.get(options.reuseWorktreeFromRunId) ?? null
  return {
    stage: resumeFromStage,
    completedStages: checkpoint?.completedStages ?? [],
    seedStage: resumeNeedsSeed(resumeFromStage) ? resumeFromStage : null,
  }
}

const WORKTREE_DIR_SHORT_ID = /-([A-Za-z0-9_-]{6})$/

/**
 * Short ids embedded in worktree directory names. WorktreeManager names each
 * task dir `<taskName>-<runId.slice(0,6)>` and its stale-GC correlates dirs to
 * keep by that trailing short id. A resumed run reuses the ORIGINAL run's dir,
 * so its dir's short id differs from its own run id — we must protect by the
 * dir name, not just the run id.
 */
export function worktreeShortIds(paths: readonly string[]): string[] {
  const ids: string[] = []
  for (const path of paths) {
    for (const segment of path.split('/')) {
      const match = segment.match(WORKTREE_DIR_SHORT_ID)
      if (match?.[1] != null) ids.push(match[1])
    }
  }
  return ids
}

/**
 * Worktree short ids that stale-worktree GC must preserve: every active run
 * (plus the dir of any worktree it reuses), budget/turn-paused runs salvaged
 * for the operator, and stalled runs awaiting resume from a durable
 * checkpoint. Without the last group a restart force-clean would delete a
 * resumable worktree before the resume can rebind it (design/04 §1, RISK 1).
 */
export function collectProtectedWorktreeShortIds(
  runRepo: RunRepo,
  taskRepo: TaskRepo,
  checkpointRepo: RunCheckpointRepo | undefined,
): Set<string> {
  const ids = new Set<string>()
  for (const run of runRepo.getActive()) {
    ids.add(run.id.slice(0, 6))
    for (const id of worktreeShortIds(run.worktreePaths ?? [])) ids.add(id)
  }
  for (const run of runRepo.listFailedWithBudgetReason()) ids.add(run.id.slice(0, 6))
  // Crash-stalled runs: protect only stages we actually auto-resume.
  for (const checkpoint of checkpointRepo?.listStalledCheckpoints() ?? []) {
    if (!isResumableCheckpoint(checkpoint)) continue
    if (!isLiveCheckpointTask(taskRepo, checkpoint)) continue
    protectCheckpoint(ids, checkpoint)
  }
  // Operator pause/freeze: resumable at any stage, so protect any with a worktree.
  for (const checkpoint of checkpointRepo?.listHaltedResumableCheckpoints() ?? []) {
    if ((checkpoint.worktreePaths ?? []).length === 0) continue
    if (!isLiveCheckpointTask(taskRepo, checkpoint)) continue
    protectCheckpoint(ids, checkpoint)
  }
  return ids
}

function isLiveCheckpointTask(taskRepo: TaskRepo, checkpoint: RunCheckpoint): boolean {
  const task = taskRepo.get(checkpoint.taskId)
  return task != null && task.status !== 'failed' && task.status !== 'done'
}

function protectCheckpoint(ids: Set<string>, checkpoint: { runId: string; worktreePaths: string[] | null }): void {
  ids.add(checkpoint.runId.slice(0, 6))
  for (const id of worktreeShortIds(checkpoint.worktreePaths ?? [])) ids.add(id)
}
