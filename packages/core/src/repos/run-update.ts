import type { SqliteDatabase } from '../db.js'
import type { RunId, RunUpdate } from '../types.js'
import { redactPublicText } from '../public-redaction.js'
import type { RunUpdateRepo } from './interfaces.js'

export class SqliteRunUpdateRepo implements RunUpdateRepo {
  constructor(private db: SqliteDatabase) {}

  list(runId: RunId): RunUpdate[] {
    return this.db
      .prepare('SELECT id, run_id AS runId, message, created_at AS createdAt FROM run_updates WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as RunUpdate[]
  }

  create(runId: RunId, message: string): RunUpdate {
    const stmt = this.db.prepare(
      'INSERT INTO run_updates (run_id, message) VALUES (?, ?) RETURNING id, run_id AS runId, message, created_at AS createdAt',
    )
    return stmt.get(runId, redactPublicText(message)) as RunUpdate
  }
}
