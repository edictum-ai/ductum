import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { initDb, type SqliteDatabase } from '../db.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

function freshDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-mig045-'))
  cleanup.push(dir)
  return initDb(join(dir, 'ductum.sqlite'))
}

/** Insert the minimal FK chain so a runs row can reference real task/agent rows. */
function seedFkChain(db: SqliteDatabase): void {
  db.prepare("INSERT INTO factories (id, name) VALUES ('f1','F')").run()
  db.prepare("INSERT INTO projects (id, factory_id, name) VALUES ('p1','f1','P')").run()
  db.prepare("INSERT INTO specs (id, project_id, name) VALUES ('s1','p1','S')").run()
  db.prepare("INSERT INTO agents (id, name, model, harness) VALUES ('a1','A','m','codex-app-server')").run()
  db.prepare("INSERT INTO tasks (id, spec_id, name) VALUES ('t1','s1','T')").run()
}

function insertRun(db: SqliteDatabase, id: string, terminalState: string | null): void {
  db.prepare('INSERT INTO runs (id, task_id, agent_id, terminal_state) VALUES (?, ?, ?, ?)').run(id, 't1', 'a1', terminalState)
}

describe('migration 045_quarantine_and_next_action', () => {
  it('accepts every legacy terminal state unchanged', () => {
    const db = freshDb()
    seedFkChain(db)
    for (const state of ['failed', 'stalled', 'cancelled', 'paused', 'frozen', null]) {
      expect(() => insertRun(db, `r-${state ?? 'null'}`, state)).not.toThrow()
    }
  })

  it('widens the terminal_state CHECK to allow the new quarantined state', () => {
    const db = freshDb()
    seedFkChain(db)
    expect(() => insertRun(db, 'r-q', 'quarantined')).not.toThrow()
    const row = db.prepare('SELECT terminal_state AS s FROM runs WHERE id = ?').get('r-q') as { s: string }
    expect(row.s).toBe('quarantined')
  })

  it('widens the runs CHECK to include exactly the prior states plus quarantined', () => {
    const db = freshDb()
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() as { sql: string }
    // The terminal_state CHECK lists every prior terminal state AND the new
    // quarantined one, and nothing else (widens only to the new state).
    expect(row.sql).toMatch(/terminal_state TEXT CHECK \(terminal_state IN \(NULL, 'failed', 'stalled', 'cancelled', 'paused', 'frozen', 'quarantined'\)\)/)
  })

  it('is idempotent and preserves a legacy terminal row across re-init', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-mig045-idem-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')
    const db = initDb(dbPath)
    seedFkChain(db)
    insertRun(db, 'r-legacy', 'failed')

    // Re-open: migrations re-run against schema_migrations (045 already applied
    // → skipped). The legacy 'failed' row survives unchanged.
    initDb(dbPath)
    const row = db.prepare('SELECT terminal_state AS s FROM runs WHERE id = ?').get('r-legacy') as { s: string }
    expect(row.s).toBe('failed')
  })
})
