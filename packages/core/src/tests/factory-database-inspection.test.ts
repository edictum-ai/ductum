import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { initDb, inspectFactoryDatabase } from '../db.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('inspectFactoryDatabase', () => {
  it('ignores neighboring ductum.yaml files when reporting DB-backed factory state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-core-inspect-'))
    cleanup.push(dir)
    const dbPath = join(dir, 'ductum.sqlite')

    writeFileSync(join(dir, 'ductum.yaml'), 'factory:\n  migratedAt: tampered\n', 'utf8')
    const db = initDb(dbPath)

    expect(inspectFactoryDatabase(dbPath)).toEqual({ state: 'empty', path: dbPath })
    db.prepare("INSERT INTO factories (id, name, config) VALUES ('factory-1', 'Ductum', '{}')").run()
    expect(inspectFactoryDatabase(dbPath)).toEqual({ state: 'has_factory', path: dbPath })
    db.close()
  })
})
