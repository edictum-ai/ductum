import { afterEach, describe, expect, it, vi } from 'vitest'
import { CIWatcher } from '../watchers/ci-watcher.js'
import { createCommandRunner, createWatcherFixture, flushWatchers } from './watcher-fixture.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  for (const fixture of cleanup.splice(0)) fixture.context.db.close()
})

describe('CI watcher PR head evidence', () => {
  it('records the current PR head SHA instead of the stale watcher snapshot SHA', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const runner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }])],
      views: [JSON.stringify({ headRefOid: 'def456' })],
    })
    const watcher = new CIWatcher(
      { type: 'ci', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter },
      { commandRunner: runner.runner },
    )

    watcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(fixture.context.runRepo.get(fixture.run.id)?.commitSha).toBe('def456')
      expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
        passed: true,
        commitSha: 'def456',
      })
    })
  })
})
