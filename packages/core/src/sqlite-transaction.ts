import type { SqliteDatabase } from './db.js'

export interface AsyncTransactionRunner {
  run<T>(operation: () => Promise<T>): Promise<T>
}

export function createSqliteTransactionRunner(db: SqliteDatabase): AsyncTransactionRunner {
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (db.inTransaction) {
        return await operation()
      }

      db.prepare('BEGIN IMMEDIATE').run()
      try {
        const result = await operation()
        db.prepare('COMMIT').run()
        return result
      } catch (error) {
        db.prepare('ROLLBACK').run()
        throw error
      }
    },
  }
}
