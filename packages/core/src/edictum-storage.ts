import type { StorageBackend } from '@edictum/core'

import type { SqliteDatabase } from './db.js'

const STORAGE_SESSION_ID = ''

export class SqliteStorageBackend implements StorageBackend {
  constructor(private readonly db: SqliteDatabase) {}

  async get(key: string): Promise<string | null> {
    const valueRow = this.db
      .prepare('SELECT value FROM edictum_session_values WHERE session_id = ? AND key = ?')
      .get(STORAGE_SESSION_ID, key) as { value: string } | undefined
    if (valueRow != null) {
      return valueRow.value
    }

    const counterRow = this.db
      .prepare('SELECT value FROM edictum_session_counters WHERE session_id = ? AND key = ?')
      .get(STORAGE_SESSION_ID, key) as { value: number } | undefined
    return counterRow == null ? null : String(counterRow.value)
  }

  async set(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `
          INSERT INTO edictum_session_values (session_id, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id, key)
          DO UPDATE SET value = excluded.value
        `,
      )
      .run(STORAGE_SESSION_ID, key, value)
  }

  async delete(key: string): Promise<void> {
    this.db
      .prepare('DELETE FROM edictum_session_values WHERE session_id = ? AND key = ?')
      .run(STORAGE_SESSION_ID, key)
    this.db
      .prepare('DELETE FROM edictum_session_counters WHERE session_id = ? AND key = ?')
      .run(STORAGE_SESSION_ID, key)
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    this.db
      .prepare(
        `
          INSERT INTO edictum_session_counters (session_id, key, value)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id, key)
          DO UPDATE SET value = value + excluded.value
        `,
      )
      .run(STORAGE_SESSION_ID, key, amount)

    const row = this.db
      .prepare('SELECT value FROM edictum_session_counters WHERE session_id = ? AND key = ?')
      .get(STORAGE_SESSION_ID, key) as { value: number } | undefined
    return row?.value ?? 0
  }

  async batchGet(keys: readonly string[]): Promise<Record<string, string | null>> {
    if (keys.length === 0) {
      return {}
    }

    const placeholders = keys.map(() => '?').join(', ')
    const params = [STORAGE_SESSION_ID, ...keys]
    const result: Record<string, string | null> = Object.fromEntries(
      keys.map((key) => [key, null] as const),
    )

    const valueRows = this.db
      .prepare(
        `
          SELECT key, value
          FROM edictum_session_values
          WHERE session_id = ? AND key IN (${placeholders})
        `,
      )
      .all(...params) as Array<{ key: string; value: string }>
    for (const row of valueRows) {
      result[row.key] = row.value
    }

    const counterRows = this.db
      .prepare(
        `
          SELECT key, value
          FROM edictum_session_counters
          WHERE session_id = ? AND key IN (${placeholders})
        `,
      )
      .all(...params) as Array<{ key: string; value: number }>
    for (const row of counterRows) {
      result[row.key] = String(row.value)
    }

    return result
  }
}
