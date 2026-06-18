import type { RunId, TaskId, WorkflowStage } from '../types.js'
import type { RunCheckpoint, RunCheckpointInput } from '../run-checkpoint.js'
import { RUN_CHECKPOINT_SCHEMA_VERSION } from '../run-checkpoint.js'
import type { RunCheckpointRepo } from './interfaces.js'
import {
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface RunCheckpointRow {
  run_id: RunId
  task_id: string
  attempt_id: string
  stage: WorkflowStage
  completed_stages: string | null
  worktree_paths: string | null
  branch: string | null
  commit_sha: string | null
  cost_usd: number
  schema_version: number
  committed_at: string
  updated_at: string
}

function mapCheckpoint(row: RunCheckpointRow): RunCheckpoint {
  return {
    runId: row.run_id,
    taskId: row.task_id as TaskId,
    attemptId: row.attempt_id,
    stage: row.stage,
    completedStages: row.completed_stages != null ? parseJson<string[]>(row.completed_stages) : [],
    worktreePaths: row.worktree_paths != null ? parseJson<string[]>(row.worktree_paths) : null,
    branch: row.branch,
    commitSha: row.commit_sha,
    costUsd: row.cost_usd,
    schemaVersion: row.schema_version,
    committedAt: toIsoString(row.committed_at) ?? row.committed_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

export class SqliteRunCheckpointRepo implements RunCheckpointRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(runId: RunId): RunCheckpoint | null {
    const row = this.db
      .prepare('SELECT * FROM run_checkpoints WHERE run_id = ?')
      .get(runId) as RunCheckpointRow | undefined
    return row == null ? null : mapCheckpoint(row)
  }

  upsert(checkpoint: RunCheckpointInput): RunCheckpoint {
    this.db
      .prepare(
        `
          INSERT INTO run_checkpoints (
            run_id, task_id, attempt_id, stage, completed_stages,
            worktree_paths, branch, commit_sha, cost_usd, schema_version,
            committed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(run_id) DO UPDATE SET
            stage = excluded.stage,
            completed_stages = excluded.completed_stages,
            worktree_paths = excluded.worktree_paths,
            branch = excluded.branch,
            commit_sha = excluded.commit_sha,
            cost_usd = excluded.cost_usd,
            schema_version = excluded.schema_version,
            updated_at = datetime('now')
        `,
      )
      .run(
        checkpoint.runId,
        checkpoint.taskId,
        checkpoint.attemptId ?? checkpoint.runId,
        checkpoint.stage,
        checkpoint.completedStages != null && checkpoint.completedStages.length > 0
          ? toJson(checkpoint.completedStages)
          : null,
        checkpoint.worktreePaths != null ? toJson(checkpoint.worktreePaths) : null,
        checkpoint.branch ?? null,
        checkpoint.commitSha ?? null,
        checkpoint.costUsd ?? 0,
        checkpoint.schemaVersion ?? RUN_CHECKPOINT_SCHEMA_VERSION,
      )
    return assertFound(this.get(checkpoint.runId), `Run checkpoint not created: ${checkpoint.runId}`)
  }

  list(taskId: TaskId): RunCheckpoint[] {
    return this.db
      .prepare(
        `
          SELECT c.* FROM run_checkpoints c
          JOIN runs r ON r.id = c.run_id
          WHERE c.task_id = ?
          ORDER BY r.created_at DESC, r.rowid DESC
        `,
      )
      .all(taskId)
      .map((row) => mapCheckpoint(row as RunCheckpointRow))
  }

  getLatestStalledCheckpoint(taskId: TaskId): RunCheckpoint | null {
    const row = this.db
      .prepare(
        `
          SELECT c.* FROM run_checkpoints c
          JOIN runs r ON r.id = c.run_id
          WHERE c.task_id = ? AND r.terminal_state = 'stalled'
          ORDER BY r.created_at DESC, r.rowid DESC
          LIMIT 1
        `,
      )
      .get(taskId) as RunCheckpointRow | undefined
    return row == null ? null : mapCheckpoint(row)
  }

  listStalledCheckpoints(): RunCheckpoint[] {
    return this.db
      .prepare(
        `
          SELECT c.* FROM run_checkpoints c
          JOIN runs r ON r.id = c.run_id
          WHERE r.terminal_state = 'stalled'
          ORDER BY r.created_at DESC, r.rowid DESC
        `,
      )
      .all()
      .map((row) => mapCheckpoint(row as RunCheckpointRow))
  }

  delete(runId: RunId): void {
    this.db.prepare('DELETE FROM run_checkpoints WHERE run_id = ?').run(runId)
  }
}
