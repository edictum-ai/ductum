import type { DispatchOptions } from './dispatcher-types.js'
import type { RunCheckpointRepo } from './repos/interfaces.js'
import { isResumableCheckpoint } from './run-checkpoint.js'
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
 * Can the crashed/stalled `run` be resumed from its own checkpoint? True
 * only when the checkpoint sits at a resumable stage with a worktree to
 * rebind, and (for non-`understand` stages) a seed hook exists to set the
 * resumed run's Edictum workflow forward to that stage.
 */
export function canResumeStalledRun(
  checkpointRepo: RunCheckpointRepo | undefined,
  run: Run,
  hasSeedHook: boolean,
): boolean {
  const checkpoint = checkpointRepo?.get(run.id) ?? null
  if (!isResumableCheckpoint(checkpoint)) return false
  return !resumeNeedsSeed(checkpoint.stage) || hasSeedHook
}

/**
 * Resume dispatch options derived from a task's latest stalled checkpoint,
 * or null to fall back to today's fresh-Run dispatch. Reuses the prior
 * worktree (`reuseWorktreeFromRunId`) and resumes at the checkpoint stage.
 */
export function resolveResumeOptions(
  checkpointRepo: RunCheckpointRepo | undefined,
  task: Task,
  hasSeedHook: boolean,
): Pick<DispatchOptions, 'reuseWorktreeFromRunId' | 'resumeFromStage'> | null {
  const checkpoint = checkpointRepo?.getLatestStalledCheckpoint(task.id) ?? null
  if (!isResumableCheckpoint(checkpoint)) return null
  if (resumeNeedsSeed(checkpoint.stage) && !hasSeedHook) return null
  return { reuseWorktreeFromRunId: checkpoint.runId, resumeFromStage: checkpoint.stage }
}

/**
 * Resolve the initial run state for a (possibly resumed) dispatch. For a
 * resume it returns the checkpoint stage + restored completedStages so the
 * new run record starts where the crashed attempt left off; otherwise the
 * default fresh `understand` start.
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
