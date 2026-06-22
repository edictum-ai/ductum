import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DUCTUM_SCHEMA_VERSION, initDb, readSchemaMigrationStatus } from '../db.js'
import { SqliteStateStore } from '../state-store.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('database schema gate', () => {
  it('refuses a database with migrations newer than this binary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-schema-gate-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    const db = initDb(dbPath)
    db.close()

    const raw = new Database(dbPath)
    raw.prepare("INSERT INTO schema_migrations (id) VALUES ('999_future_schema')").run()
    raw.close()

    expect(() => initDb(dbPath)).toThrow(
      /Unsupported Ductum database schema: found migration\(s\) newer than this binary: 999_future_schema/,
    )
  })

  it('reports schema status through the SQLite state store wrapper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-state-store-'))
    cleanup.push(dir)

    const store = SqliteStateStore.open(join(dir, 'ductum.sqlite'))
    const status = store.schemaStatus()

    expect(store.kind).toBe('sqlite')
    expect(status.binarySchemaVersion).toBe(DUCTUM_SCHEMA_VERSION)
    expect(status.onDiskSchemaVersion).toBe(DUCTUM_SCHEMA_VERSION)
    expect(status.appliedSchemaVersion).toBe(DUCTUM_SCHEMA_VERSION)
    expect(status.unknownMigrationIds).toEqual([])
    expect(readSchemaMigrationStatus(store.db)).toEqual(status)
    expect(store.repos.agents.list()).toEqual([])
    store.close()
  })
})
