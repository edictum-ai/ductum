import type { SqliteDatabase } from '../db.js'
import type { TaskId } from '../types.js'
import type { TaskDispatchSkip } from '../task-dispatch-skip-types.js'
import { toIsoString } from './utils.js'

interface TaskDispatchSkipRow {
  taskId: TaskId
  reason: string
  detail: string | null
  skippedAt: string
  updatedAt: string
}

export interface TaskDispatchSkipRepo {
  get(taskId: TaskId): TaskDispatchSkip | null
  list(): TaskDispatchSkip[]
  record(input: { taskId: TaskId; reason: string; detail: string | null; skippedAt: string }): void
  clear(taskId: TaskId): void
}

export class SqliteTaskDispatchSkipRepo implements TaskDispatchSkipRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(taskId: TaskId): TaskDispatchSkip | null {
    const row = this.db
      .prepare(
        `SELECT task_id AS taskId, reason, detail, skipped_at AS skippedAt, updated_at AS updatedAt
         FROM task_dispatch_skips
         WHERE task_id = ?`,
      )
      .get(taskId) as TaskDispatchSkipRow | undefined
    return row == null ? null : mapRow(row)
  }

  list(): TaskDispatchSkip[] {
    return this.db
      .prepare(
        `SELECT task_id AS taskId, reason, detail, skipped_at AS skippedAt, updated_at AS updatedAt
         FROM task_dispatch_skips
         ORDER BY updated_at DESC, task_id`,
      )
      .all()
      .map((row) => mapRow(row as TaskDispatchSkipRow))
  }

  record(input: { taskId: TaskId; reason: string; detail: string | null; skippedAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO task_dispatch_skips (task_id, reason, detail, skipped_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(task_id) DO UPDATE SET
           skipped_at = CASE
             WHEN task_dispatch_skips.reason = excluded.reason THEN task_dispatch_skips.skipped_at
             ELSE excluded.skipped_at
           END,
           reason = excluded.reason,
           detail = excluded.detail,
           updated_at = datetime('now')`,
      )
      .run(input.taskId, input.reason, input.detail, input.skippedAt.replace('T', ' ').replace('Z', ''))
  }

  clear(taskId: TaskId): void {
    this.db.prepare('DELETE FROM task_dispatch_skips WHERE task_id = ?').run(taskId)
  }
}

function mapRow(row: TaskDispatchSkipRow): TaskDispatchSkip {
  return {
    taskId: row.taskId,
    reason: row.reason,
    detail: row.detail,
    skippedAt: toIsoString(row.skippedAt) ?? row.skippedAt,
    updatedAt: toIsoString(row.updatedAt) ?? row.updatedAt,
  }
}
