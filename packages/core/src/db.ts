import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { applyMigration, MIGRATIONS, type SqliteDatabase } from './db-migrations.js'

export type { SqliteDatabase } from './db-migrations.js'

export const DUCTUM_SCHEMA_VERSION = MIGRATIONS.length

export interface SchemaMigrationStatus {
  binarySchemaVersion: number
  onDiskSchemaVersion: number
  appliedSchemaVersion: number
  appliedMigrationIds: string[]
  unknownMigrationIds: string[]
}

export function initDb(dbPath: string): SqliteDatabase {
  const db = new Database(dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)

    assertSupportedSchemaVersion(db)

    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
    const record = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)')

    for (const migration of MIGRATIONS) {
      if (applied.get(migration.id) == null) {
        if (
          migration.id === '008_workflow_stages' ||
          migration.id === '011_multi_role_agents' ||
          migration.id === '012_harness_vercel_ai' ||
          migration.id === '027_harness_string_columns' ||
          migration.id === '030_spec_status_failed' ||
          migration.id === '034_run_terminal_cancelled' ||
          migration.id === '035_exit_demo_evidence_type' ||
          migration.id === '042_run_checkpoints' ||
          migration.id === '045_quarantine_and_next_action'
        ) {
          // Table rebuild needs FK checks off,
          // and PRAGMA foreign_keys can't be changed inside a transaction
          db.pragma('foreign_keys = OFF')
          db.transaction(() => {
            applyMigration(db, migration)
            record.run(migration.id)
          })()
          db.pragma('foreign_keys = ON')
        } else {
          db.transaction(() => {
            applyMigration(db, migration)
            record.run(migration.id)
          })()
        }
      }
    }

    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function readSchemaMigrationStatus(db: SqliteDatabase): SchemaMigrationStatus {
  const knownIds = new Set<string>(MIGRATIONS.map((migration) => migration.id))
  const appliedMigrationIds = db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => (row as { id: string }).id)
  const unknownMigrationIds = appliedMigrationIds.filter((id) => !knownIds.has(id))
  return {
    binarySchemaVersion: DUCTUM_SCHEMA_VERSION,
    onDiskSchemaVersion: appliedMigrationIds.length,
    appliedSchemaVersion: appliedMigrationIds.length - unknownMigrationIds.length,
    appliedMigrationIds,
    unknownMigrationIds,
  }
}

export function assertSupportedSchemaVersion(db: SqliteDatabase): void {
  const status = readSchemaMigrationStatus(db)
  if (status.unknownMigrationIds.length === 0) return
  throw new Error(
    [
      `Unsupported Ductum database schema: found migration(s) newer than this binary: ${status.unknownMigrationIds.join(', ')}`,
      'Upgrade Ductum before opening this factory.',
    ].join(' '),
  )
}

export type FactoryDatabaseState = 'missing' | 'no_schema' | 'empty' | 'has_factory'

export interface FactoryDatabaseInspection {
  state: FactoryDatabaseState
  path: string
}

export function inspectFactoryDatabase(dbPath: string): FactoryDatabaseInspection {
  if (!existsSync(dbPath)) return { state: 'missing', path: dbPath }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const factoriesTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'factories'")
      .get()
    if (factoriesTable == null) return { state: 'no_schema', path: dbPath }
    const factory = db.prepare('SELECT 1 FROM factories LIMIT 1').get()
    return { state: factory == null ? 'empty' : 'has_factory', path: dbPath }
  } finally {
    db.close()
  }
}
