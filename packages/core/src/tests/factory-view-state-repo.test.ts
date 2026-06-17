import { afterEach, describe, expect, it } from 'vitest'
import { createId, initDb, SqliteFactoryRepo, SqliteFactoryViewStateRepo, type SqliteDatabase } from '../index.js'

let db: SqliteDatabase | undefined

afterEach(() => {
  db?.close()
  db = undefined
})

describe('Factory view state repository', () => {
  it('preserves the newest Home last-look timestamp', () => {
    db = initDb(':memory:')
    const factoryRepo = new SqliteFactoryRepo(db)
    const viewStateRepo = new SqliteFactoryViewStateRepo(db)
    const factory = factoryRepo.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const first = '2026-06-16T12:00:00.000Z'
    const newer = '2026-06-16T12:05:00.000Z'
    expect(viewStateRepo.upsert(factory.id, { homeLastSeenAt: first }).homeLastSeenAt).toBe(first)
    expect(viewStateRepo.upsert(factory.id, { homeLastSeenAt: newer }).homeLastSeenAt).toBe(newer)
    expect(viewStateRepo.upsert(factory.id, { homeLastSeenAt: first }).homeLastSeenAt).toBe(newer)
    expect(viewStateRepo.upsert(factory.id, { homeLastSeenAt: null }).homeLastSeenAt).toBe(newer)
    expect(() => viewStateRepo.upsert(factory.id, { homeLastSeenAt: '2026-06-16T12:00:00Z' }))
      .toThrow(/canonical ISO timestamp/)
  })
})
