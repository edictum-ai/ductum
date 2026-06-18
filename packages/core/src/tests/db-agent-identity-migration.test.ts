import { describe, expect, it } from 'vitest'

import { applyMigration, MIGRATIONS } from '../db-migrations.js'
import { initDb } from '../db.js'

describe('agent provider/account identity migration', () => {
  it('is idempotent when replayed against an already-migrated database', () => {
    const db = initDb(':memory:')
    const migration = MIGRATIONS.find((item) => item.id === '043_agent_provider_account_identity')
    if (migration == null) throw new Error('missing agent provider/account identity migration')

    expect(() => {
      applyMigration(db, migration)
      applyMigration(db, migration)
    }).not.toThrow()
    expect(db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'provider_id'").get()).toEqual({
      name: 'provider_id',
    })
    expect(db.prepare("SELECT name FROM pragma_table_info('agents') WHERE name = 'account_id'").get()).toEqual({
      name: 'account_id',
    })

    db.close()
  })
})
