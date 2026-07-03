import { afterEach, describe, expect, it } from 'vitest'

import { evaluateRunExecutionIntegrity } from '../execution-integrity.js'
import type { Evidence } from '../types.js'
import { isEmptyWatcherPlaceholderRun } from '../watcher-manager.js'
import { createCommandRunner, createManager, createWatcherFixture, childRunsFor, flushWatchers } from './watcher-fixture.js'
import type { Run } from '../types.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  for (const fixture of cleanup.splice(0)) fixture.context.db.close()
})

describe('WatcherManager approval lifecycle suppression', () => {
  it('cancels empty watcher children (does not mark them as successful done) when the root is already awaiting approval', async () => {
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
    // Pin the QkQnxFSZ_J0v residual shape: the placeholder must be cancelled
    // (terminalState='cancelled'), NOT marked as a successful `done` run.
    // `stage` stays at 'understand' so the placeholder cannot be rendered as
    // completion evidence; lineage fields stay empty so execution-integrity
    // cannot pick it up as ductum lineage either.
    const ghostAfter = fixture.context.runRepo.get(ghost.id)!
    expect(ghostAfter.stage).toBe('understand')
    expect(ghostAfter.terminalState).toBe('cancelled')
    expect(ghostAfter.failReason).toBe('Parent run already awaiting approval')
    expect(ghostAfter.sessionId).toBeNull()
    expect(ghostAfter.worktreePaths ?? []).toHaveLength(0)
    expect(ghostAfter.completedStages).toEqual([])
    expect(ghostAfter.pendingApproval).toBe(false)
    expect(ghostAfter.blockedReason).toBeNull()
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

  it('cancelled empty watcher child is not detected as a latest real attempt and carries no completion evidence', () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const ghost = createEmptyWatcherChild(fixture, 'run-ghost')
    fixture.context.runRepo.updateTerminalState(ghost.id, 'cancelled')
    fixture.context.runRepo.updateFailure(ghost.id, 'Parent run awaiting approval', false)

    const ghostAfter = fixture.context.runRepo.get(ghost.id)!
    // Parent-agnostic placeholder detection treats the cancelled child as a
    // placeholder: operator latest-run guards rely on this so retry/redirect
    // on the real parent run is not blocked solely by the placeholder's
    // created_at ordering.
    expect(isEmptyWatcherPlaceholderRun(ghostAfter)).toBe(true)

    // Stale parent PR metadata on the placeholder must not turn into completion
    // evidence. The placeholder is not `done` and has no Ductum lineage, no
    // external outcome, no recorded import — execution-integrity flags it.
    const integrity = evaluateRunExecutionIntegrity(ghostAfter, [] as readonly Evidence[])
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.externalOutcome).toBeNull()
    expect(integrity.hasExternalOutcome).toBe(false)
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
