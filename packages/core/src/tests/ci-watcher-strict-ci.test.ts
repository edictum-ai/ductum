import { afterEach, describe, expect, it, vi } from 'vitest'

import { CIWatcher } from '../watchers/ci-watcher.js'
import { createCommandRunner, createWatcherFixture, flushWatchers } from './watcher-fixture.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  vi.useRealTimers()
  for (const fixture of cleanup.splice(0)) {
    fixture.context.db.close()
  }
})

describe('CI watcher strict CI classification', () => {
  it('fails skipped-only CI instead of treating it as green', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const runner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'skipped' }])],
    })
    const watcher = new CIWatcher(
      { type: 'ci', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter },
      { commandRunner: runner.runner },
    )

    watcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({ passed: false })
    })
  })

  it('leaves empty CI check sets unresolved until timeout', async () => {
    vi.useFakeTimers()
    let now = 0

    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const runner = createCommandRunner({ checks: [JSON.stringify([])] })
    const watcher = new CIWatcher(
      { type: 'ci', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter },
      { commandRunner: runner.runner, now: () => now },
    )

    watcher.start()
    await flushWatchers()
    expect(fixture.context.evidenceRepo.list(fixture.run.id)).toHaveLength(0)

    now = 6_000
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => {
      expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
        passed: false,
        reason: 'CI timed out',
      })
    })
  })
})
