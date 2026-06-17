import { afterEach, describe, expect, it } from 'vitest'

import { SqliteStorageBackend } from '../edictum-storage.js'
import { createRepoContext } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
})

function createStorage() {
  const context = createRepoContext()
  cleanup.push(context)
  return new SqliteStorageBackend(context.db)
}

describe('SqliteStorageBackend', () => {
  it('round-trips get, set, delete, and increment', async () => {
    const storage = createStorage()

    expect(await storage.get('s:run-1:workflow')).toBeNull()

    await storage.set('s:run-1:workflow', '{"stage":"implementing"}')
    expect(await storage.get('s:run-1:workflow')).toBe('{"stage":"implementing"}')

    await storage.delete('s:run-1:workflow')
    expect(await storage.get('s:run-1:workflow')).toBeNull()

    expect(await storage.increment('s:run-1:attempts', 2)).toBe(2)
    expect(await storage.increment('s:run-1:attempts', 3)).toBe(5)
    expect(await storage.get('s:run-1:attempts')).toBe('5')
  })

  it('supports batchGet across values and counters', async () => {
    const storage = createStorage()

    await storage.set('s:run-2:workflow_state__coding-guard', '{"activeStage":"implementing"}')
    await storage.increment('s:run-2:attempts', 2)

    expect(
      await storage.batchGet([
        's:run-2:workflow_state__coding-guard',
        's:run-2:attempts',
        's:run-2:missing',
      ]),
    ).toEqual({
      's:run-2:workflow_state__coding-guard': '{"activeStage":"implementing"}',
      's:run-2:attempts': '2',
      's:run-2:missing': null,
    })
  })
})
