import type { Run, RunId, TaskId, WorkflowStage } from './types.js'

/**
 * Durable per-run checkpoint (design/04 §1 — Checkpoint / Resume).
 *
 * Written at every forward stage advance and mirrors the run's last
 * durably-committed progress: the stage to resume at, the worktree paths
 * to rebind, and the pinned head (branch + commit). On a crash the
 * recovery path reads this row to resume the same attempt at its last
 * stage on the same worktree, instead of re-dispatching a brand-new run
 * at `understand` with a fresh worktree.
 *
 * `attemptId` equals the run id today (one attempt per run). It is kept
 * as a distinct field for the future lease / attempt-identity work
 * (design/04 §2) so resume identity has a stable name now.
 */
export interface RunCheckpoint {
  runId: RunId
  taskId: TaskId
  attemptId: string
  /** The active stage to resume at (the last forward gate reached). */
  stage: WorkflowStage
  completedStages: string[]
  /** Worktree paths to rebind on resume (the prior attempt's worktree). */
  worktreePaths: string[] | null
  branch: string | null
  /** Pinned head SHA of the worktree, when known. */
  commitSha: string | null
  /** Cost accrued by the attempt up to this checkpoint. */
  costUsd: number
  schemaVersion: number
  committedAt: string
  updatedAt: string
}

export interface RunCheckpointInput {
  runId: RunId
  taskId: TaskId
  attemptId?: string
  stage: WorkflowStage
  completedStages?: string[]
  worktreePaths?: string[] | null
  branch?: string | null
  commitSha?: string | null
  costUsd?: number
  schemaVersion?: number
}

export const RUN_CHECKPOINT_SCHEMA_VERSION = 1

/**
 * Stages a crashed attempt can be forward-resumed into without replaying
 * an irreversible side effect (design/04 §1 resumable-vs-rollback split).
 * `understand` / `implement` have no committed external effect, so the
 * prior worktree + diff can be reused. Stages that push/merge are
 * rollback-required and must fall back to the safe fresh-Run baseline.
 */
export const RESUMABLE_STAGES: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>([
  'understand',
  'implement',
])

/**
 * A checkpoint is resumable when it sits at a safely-resumable stage and
 * still has a worktree to rebind. Anything else falls back to today's
 * fresh-Run dispatch (a strict optimization over a safe baseline).
 */
export function isResumableCheckpoint(
  checkpoint: RunCheckpoint | null | undefined,
): checkpoint is RunCheckpoint {
  return (
    checkpoint != null &&
    RESUMABLE_STAGES.has(checkpoint.stage) &&
    checkpoint.worktreePaths != null &&
    checkpoint.worktreePaths.length > 0
  )
}

/** Build a checkpoint snapshot from a run's current durable fields. */
export function buildCheckpointInput(run: Run, stage?: WorkflowStage): RunCheckpointInput {
  return {
    runId: run.id,
    taskId: run.taskId,
    attemptId: run.id,
    stage: stage ?? run.stage,
    completedStages: run.completedStages,
    worktreePaths: run.worktreePaths,
    branch: run.branch,
    commitSha: run.commitSha,
    costUsd: run.costUsd,
    schemaVersion: RUN_CHECKPOINT_SCHEMA_VERSION,
  }
}
