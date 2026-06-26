import { afterEach, describe, expect, it } from 'vitest'

import { createCommandRunner, createManager, createWatcherFixture, childRunsFor, flushWatchers } from './watcher-fixture.js'
import type { Run } from '../types.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  for (const fixture of cleanup.splice(0)) fixture.context.db.close()
})

describe('WatcherManager approval lifecycle suppression', () => {
  it('does not spawn empty watcher children after the root is already awaiting approval', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    fixture.context.runRepo.updateWorkflowState(fixture.run.id, { pendingApproval: true })
    const ghost = createEmptyWatcherChild(fixture, 'run-ghost')
    const manager = createManager(fixture, createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'in_progress', conclusion: null }])],
      reviews: [JSON.stringify({ reviewDecision: null, latestReviews: [] })],
    }).runner)

    manager.spawnWatchers(fixture.context.runRepo.get(fixture.run.id)!)
    await flushWatchers()

    expect(manager.activeCount()).toBe(0)
    expect(fixture.context.runRepo.get(ghost.id)?.stage).toBe('done')
    expect(childRunsFor(fixture)).toHaveLength(1)
  })

  it('stops watcher children when the root starts awaiting approval', async () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const manager = createManager(fixture, createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'in_progress', conclusion: null }])],
      reviews: [JSON.stringify({ reviewDecision: null, latestReviews: [] })],
    }).runner)

    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: fixture.run.id, from: 'implement', to: 'ship' })
    await flushWatchers()
    expect(manager.activeCount()).toBe(1)
    expect(childRunsFor(fixture)).toHaveLength(2)

    fixture.context.runRepo.updateWorkflowState(fixture.run.id, { pendingApproval: true })
    fixture.eventEmitter.emit({ type: 'run.awaiting_approval', runId: fixture.run.id })

    expect(manager.activeCount()).toBe(0)
    expect(childRunsFor(fixture).every((run) => run.stage === 'done')).toBe(true)
  })
})

function createEmptyWatcherChild(
  fixture: ReturnType<typeof createWatcherFixture>,
  id: string,
): Run {
  const parent = fixture.context.runRepo.get(fixture.run.id)!
  return fixture.context.runRepo.create({
    id: id as Run['id'],
    taskId: parent.taskId,
    agentId: parent.agentId,
    parentRunId: parent.id,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: parent.branch,
    commitSha: parent.commitSha,
    prNumber: parent.prNumber,
    prUrl: parent.prUrl,
    worktreePaths: null,
    runtimeWorkflowProfile: parent.runtimeWorkflowProfile,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: parent.lastHeartbeat,
    heartbeatTimeoutSeconds: 60,
  })
}
