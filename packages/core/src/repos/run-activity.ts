import type { SqliteDatabase } from '../db.js'
import type { RunActivity, RunActivityKind, RunId } from '../types.js'
import { redactPublicText } from '../public-redaction.js'

export interface RunActivityRepo {
  list(runId: RunId, limit?: number): RunActivity[]
  create(runId: RunId, kind: RunActivityKind, content: string, toolName?: string): RunActivity
}

export class SqliteRunActivityRepo implements RunActivityRepo {
  constructor(private db: SqliteDatabase) {}

  list(runId: RunId, limit = 200): RunActivity[] {
    // Return the LATEST N events in chronological order. Previously this
    // ordered ASC and limited, which froze the visible window on the
    // first 200 events forever — long runs went silent for operators
    // and dashboard transcripts dropped every Edit/Write past #200.
    // Operators can now request more (CLI passes --limit through) or
    // accept the default 200 most-recent events.
    const rows = this.db
      .prepare(
        `SELECT id, run_id AS runId, kind, content, tool_name AS toolName, created_at AS createdAt
         FROM run_activity WHERE run_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(runId, limit) as RunActivity[]
    return rows.reverse()
  }

  create(runId: RunId, kind: RunActivityKind, content: string, toolName?: string): RunActivity {
    return this.db
      .prepare(
        `INSERT INTO run_activity (run_id, kind, content, tool_name)
         VALUES (?, ?, ?, ?)
         RETURNING id, run_id AS runId, kind, content, tool_name AS toolName, created_at AS createdAt`,
      )
      .get(
        runId,
        kind,
        redactPublicText(content),
        toolName == null ? null : redactPublicText(toolName),
      ) as RunActivity
  }
}
