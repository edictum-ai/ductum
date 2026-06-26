import { afterEach, describe, expect, it, vi } from 'vitest'
import { CIWatcher } from '../watchers/ci-watcher.js'
import { ReviewWatcher } from '../watchers/review-watcher.js'
import { createCommandRunner, createManager, createWatcherFixture, childRunsFor, flushWatchers } from './watcher-fixture.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  vi.useRealTimers()
  for (const fixture of cleanup.splice(0)) {
    fixture.context.db.close()
  }
})

describe('watchers', () => {
  it('resolves CI pass, polls while pending, times out, and discards stale commits', async () => {
    vi.useFakeTimers()
    let now = 0
    const passFixture = createWatcherFixture('ship')
    cleanup.push(passFixture)
    const passRunner = createCommandRunner({
      checks: [
        JSON.stringify([{ name: 'unit', state: 'in_progress', conclusion: null }]),
        JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }]),
      ],
    })
    const onResolved = vi.fn(async () => {})
    const passWatcher = new CIWatcher(
      { type: 'ci', parentRunId: passFixture.run.id, commitSha: passFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: passFixture.run.prUrl! },
      { runRepo: passFixture.context.runRepo, evidenceRepo: passFixture.context.evidenceRepo, stateMachine: passFixture.stateMachine, eventEmitter: passFixture.eventEmitter, onWatcherResolved: onResolved },
      { commandRunner: passRunner.runner, now: () => now },
    )
    passWatcher.start()
    await flushWatchers()
    expect(passRunner.calls.checks).toBe(1)
    expect(passFixture.context.evidenceRepo.list(passFixture.run.id)).toHaveLength(0)
    now = 1_000
    await vi.advanceTimersByTimeAsync(1_000)
    expect(passRunner.calls.checks).toBe(2)
    await vi.waitFor(() => {
      expect(passFixture.context.evidenceRepo.list(passFixture.run.id)[0]?.payload).toMatchObject({ passed: true, commitSha: 'abc123' })
      expect(onResolved).toHaveBeenCalledWith(passFixture.run.id, 'ci', true)
    })
    const passChild = childRunsFor(passFixture)[0]
    expect(passChild?.stage).toBe('done')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(passRunner.calls.checks).toBe(2)

    const timeoutFixture = createWatcherFixture('ship')
    cleanup.push(timeoutFixture)
    const timeoutRunner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'in_progress', conclusion: null }])],
    })
    const timeoutResolved = vi.fn(async () => {})
    const timeoutWatcher = new CIWatcher(
      { type: 'ci', parentRunId: timeoutFixture.run.id, commitSha: timeoutFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: timeoutFixture.run.prUrl! },
      { runRepo: timeoutFixture.context.runRepo, evidenceRepo: timeoutFixture.context.evidenceRepo, stateMachine: timeoutFixture.stateMachine, eventEmitter: timeoutFixture.eventEmitter, onWatcherResolved: timeoutResolved },
      { commandRunner: timeoutRunner.runner, now: () => now },
    )
    timeoutWatcher.start()
    await flushWatchers()
    now = 6_000
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => {
      expect(timeoutFixture.context.evidenceRepo.list(timeoutFixture.run.id)[0]?.payload).toMatchObject({ reason: 'CI timed out', passed: false })
      expect(timeoutResolved).toHaveBeenCalledWith(timeoutFixture.run.id, 'ci', false)
    })

    const staleFixture = createWatcherFixture('ship')
    cleanup.push(staleFixture)
    const staleRunner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }])],
    })
    staleFixture.context.runRepo.updateGitArtifacts(staleFixture.run.id, { commitSha: 'def456' })
    const staleWatcher = new CIWatcher(
      { type: 'ci', parentRunId: staleFixture.run.id, commitSha: 'abc123', pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: staleFixture.run.prUrl! },
      { runRepo: staleFixture.context.runRepo, evidenceRepo: staleFixture.context.evidenceRepo, stateMachine: staleFixture.stateMachine, eventEmitter: staleFixture.eventEmitter },
      { commandRunner: staleRunner.runner, now: () => now },
    )
    staleWatcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      // Stale commit: no evidence attached, child run finalized
      expect(staleFixture.context.evidenceRepo.list(staleFixture.run.id)).toHaveLength(0)
      expect(childRunsFor(staleFixture)[0]?.stage).toBe('done')
    })
  })

  it('fails CI when any check fails and ignores duplicate signals', async () => {
    const failFixture = createWatcherFixture('ship')
    cleanup.push(failFixture)
    const failRunner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'failure' }])],
    })
    const failResolved = vi.fn(async () => {})
    const failWatcher = new CIWatcher(
      { type: 'ci', parentRunId: failFixture.run.id, commitSha: failFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: failFixture.run.prUrl! },
      { runRepo: failFixture.context.runRepo, evidenceRepo: failFixture.context.evidenceRepo, stateMachine: failFixture.stateMachine, eventEmitter: failFixture.eventEmitter, onWatcherResolved: failResolved },
      { commandRunner: failRunner.runner },
    )
    failWatcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(failFixture.context.evidenceRepo.list(failFixture.run.id)[0]?.payload).toMatchObject({ passed: false })
      expect(failResolved).toHaveBeenCalledWith(failFixture.run.id, 'ci', false)
    })

    // Duplicate signal: ciStatus already set to pass — watcher should ignore
    const duplicateFixture = createWatcherFixture('ship')
    cleanup.push(duplicateFixture)
    duplicateFixture.context.runRepo.updateLatchStatus(duplicateFixture.run.id, 'ciStatus', 'pass')
    const duplicateRunner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'failure' }])],
    })
    const duplicateWatcher = new CIWatcher(
      { type: 'ci', parentRunId: duplicateFixture.run.id, commitSha: duplicateFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: duplicateFixture.run.prUrl! },
      { runRepo: duplicateFixture.context.runRepo, evidenceRepo: duplicateFixture.context.evidenceRepo, stateMachine: duplicateFixture.stateMachine, eventEmitter: duplicateFixture.eventEmitter },
      { commandRunner: duplicateRunner.runner },
    )
    duplicateWatcher.start()
    await flushWatchers()
    expect(duplicateFixture.context.evidenceRepo.list(duplicateFixture.run.id)).toHaveLength(0)
    expect(duplicateFixture.context.runRepo.get(duplicateFixture.run.id)?.ciStatus).toBe('pass')
  })


  it('resolves review approval and requested changes', async () => {
    const approveFixture = createWatcherFixture('ship')
    cleanup.push(approveFixture)
    const approveRunner = createCommandRunner({
      reviews: [
        JSON.stringify({
          reviewDecision: 'APPROVED',
          latestReviews: [
            { author: { login: 'codex' }, state: 'APPROVED', body: '', submittedAt: '2026-04-04T10:00:00Z' },
          ],
        }),
      ],
    })
    const approveResolved = vi.fn(async () => {})
    const approveWatcher = new ReviewWatcher(
      { type: 'review', parentRunId: approveFixture.run.id, commitSha: approveFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: approveFixture.run.prUrl! },
      { runRepo: approveFixture.context.runRepo, evidenceRepo: approveFixture.context.evidenceRepo, stateMachine: approveFixture.stateMachine, eventEmitter: approveFixture.eventEmitter, onWatcherResolved: approveResolved },
      { commandRunner: approveRunner.runner },
    )
    approveWatcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(approveFixture.context.evidenceRepo.list(approveFixture.run.id)[0]?.payload).toMatchObject({ passed: true })
      expect(approveResolved).toHaveBeenCalledWith(approveFixture.run.id, 'review', true)
    })

    const rejectFixture = createWatcherFixture('ship')
    cleanup.push(rejectFixture)
    const rejectRunner = createCommandRunner({
      reviews: [
        JSON.stringify({
          reviewDecision: 'CHANGES_REQUESTED',
          latestReviews: [
            {
              author: { login: 'codex' },
              state: 'CHANGES_REQUESTED',
              body: 'fix lint\nfix tests',
              submittedAt: '2026-04-04T10:01:00Z',
            },
          ],
        }),
      ],
    })
    const rejectResolved = vi.fn(async () => {})
    const rejectWatcher = new ReviewWatcher(
      { type: 'review', parentRunId: rejectFixture.run.id, commitSha: rejectFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: rejectFixture.run.prUrl! },
      { runRepo: rejectFixture.context.runRepo, evidenceRepo: rejectFixture.context.evidenceRepo, stateMachine: rejectFixture.stateMachine, eventEmitter: rejectFixture.eventEmitter, onWatcherResolved: rejectResolved },
      { commandRunner: rejectRunner.runner },
    )
    rejectWatcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(rejectFixture.context.evidenceRepo.list(rejectFixture.run.id)[0]?.payload).toMatchObject({ passed: false })
      expect(rejectResolved).toHaveBeenCalledWith(rejectFixture.run.id, 'review', false)
    })

    // Superseded review: APPROVED overrides older CHANGES_REQUESTED
    const supersededFixture = createWatcherFixture('ship')
    cleanup.push(supersededFixture)
    const supersededRunner = createCommandRunner({
      reviews: [
        JSON.stringify({
          reviewDecision: 'APPROVED',
          latestReviews: [
            {
              author: { login: 'codex' },
              state: 'APPROVED',
              body: '',
              submittedAt: '2026-04-04T10:02:00Z',
            },
            {
              author: { login: 'review-bot' },
              state: 'CHANGES_REQUESTED',
              body: 'old finding',
              submittedAt: '2026-04-04T09:59:00Z',
            },
          ],
        }),
      ],
    })
    const supersededResolved = vi.fn(async () => {})
    const supersededWatcher = new ReviewWatcher(
      { type: 'review', parentRunId: supersededFixture.run.id, commitSha: supersededFixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: supersededFixture.run.prUrl! },
      { runRepo: supersededFixture.context.runRepo, evidenceRepo: supersededFixture.context.evidenceRepo, stateMachine: supersededFixture.stateMachine, eventEmitter: supersededFixture.eventEmitter, onWatcherResolved: supersededResolved },
      { commandRunner: supersededRunner.runner },
    )
    supersededWatcher.start()
    await flushWatchers()
    await vi.waitFor(() => {
      expect(supersededFixture.context.evidenceRepo.list(supersededFixture.run.id)[0]?.payload).toMatchObject({ passed: true })
      expect(supersededResolved).toHaveBeenCalledWith(supersededFixture.run.id, 'review', true)
    })
  })

  it('spawns, stops, and respawns watchers on re-push', async () => {
    vi.useFakeTimers()
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const outputs = createCommandRunner({
      checks: [
        JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }]),
        JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }]),
      ],
      reviews: [
        JSON.stringify({
          reviewDecision: 'APPROVED',
          latestReviews: [
            { author: { login: 'codex' }, state: 'APPROVED', body: '', submittedAt: '2026-04-04T10:00:00Z' },
          ],
        }),
        JSON.stringify({ reviewDecision: null, latestReviews: [] }),
        JSON.stringify({ reviewDecision: null, latestReviews: [] }),
      ],
    })
    const manager = createManager(fixture, outputs.runner)

    // WatcherManager listens for run.stage_changed events with to === 'ship'
    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    await vi.waitFor(() => {
      // Both watchers settle (evidence written), but manager still holds the map entry
      expect(fixture.context.evidenceRepo.list(fixture.run.id).map((item) => item.type).sort()).toEqual(['ci', 'review'])
    })

    // Explicitly stop watchers before re-push (simulates stage reset)
    manager.stopWatchers(fixture.run.id, 'manual reset')
    expect(manager.activeCount()).toBe(0)

    // Simulate re-push: update commit and re-emit ship event
    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, { commitSha: 'repush456' })
    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    // Second batch: CI resolves (success) but review is pending (null) — 1 active watcher set
    await vi.waitFor(() => {
      expect(manager.activeCount()).toBe(1)
    })
    expect(childRunsFor(fixture)).toHaveLength(4)
    manager.stopWatchers(fixture.run.id)
    expect(manager.activeCount()).toBe(0)
    expect(childRunsFor(fixture).every((run) => run.stage === 'done')).toBe(true)
    manager.dispose()
  })

  it('does not duplicate watchers for the same commit and requires branch + PR metadata', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const outputs = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'in_progress', conclusion: null }])],
      reviews: [JSON.stringify({ reviewDecision: null, latestReviews: [] })],
    })
    const manager = createManager(fixture, outputs.runner)

    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, { branch: null })
    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    expect(manager.activeCount()).toBe(0)

    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, { branch: 'feat/p9-watchers' })
    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    expect(manager.activeCount()).toBe(1)
    expect(fixture.context.runRepo.get(fixture.run.id)?.ciStatus).toBe('pending')
    expect(fixture.context.runRepo.get(fixture.run.id)?.reviewStatus).toBe('pending')
    expect(childRunsFor(fixture)).toHaveLength(2)

    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    expect(manager.activeCount()).toBe(1)
    expect(childRunsFor(fixture)).toHaveLength(2)

    manager.dispose()
  })
})
