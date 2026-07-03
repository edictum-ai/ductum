import { afterEach, describe, expect, it } from 'vitest'

import { evaluateRunExecutionIntegrity } from '../execution-integrity.js'
import type { Evidence } from '../types.js'
import { isEmptyWatcherPlaceholderRun, isInvalidDoneWatcherBookkeepingRun } from '../watcher-manager.js'
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

  it('cancels watcher children when the root starts awaiting approval (does not mark them successful done)', async () => {
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
    // Pin the QkQnxFSZ_J0v residual shape for real watcher children stopped
    // because the parent entered approval: the child must NOT become a
    // successful `done` run. It keeps `stage: 'understand'` and gains
    // `terminalState: 'cancelled'` with the shutdown reason as `failReason`.
    // Lineage fields stay empty so neither execution-integrity nor the
    // operator latest-run guard can render it as completed work.
    const children = childRunsFor(fixture)
    expect(children).toHaveLength(2)
    for (const child of children) {
      expect(child.stage).toBe('understand')
      expect(child.terminalState).toBe('cancelled')
      expect(child.failReason).toBe('Parent run awaiting approval')
      expect(child.sessionId).toBeNull()
      expect(child.worktreePaths ?? []).toHaveLength(0)
      expect(child.completedStages).toEqual([])
      expect(child.pendingApproval).toBe(false)
      expect(child.blockedReason).toBeNull()
      expect(isEmptyWatcherPlaceholderRun(child)).toBe(true)
    }
  })

  it('isInvalidDoneWatcherBookkeepingRun flags the historical Qk-shaped done row but not real work', () => {
    const fixture = createWatcherFixture('ship')
    cleanup.push(fixture)
    const parent = fixture.context.runRepo.get(fixture.run.id)!

    // Historical Qk shape: a no-lineage child marked `done` by an older
    // BaseWatcher.stop() path with a watcher/approval shutdown failReason.
    // Recreate the exact live shape: stage='done', terminalState=null,
    // failReason='Parent run awaiting approval', stale copied PR metadata,
    // no session/worktree/completed stages.
    const qk = createEmptyWatcherChild(fixture, 'run-qk')
    fixture.context.runRepo.updateStage(qk.id, 'done', 'Parent run awaiting approval')
    const qkAfter = fixture.context.runRepo.get(qk.id)!
    expect(qkAfter.stage).toBe('done')
    expect(qkAfter.terminalState).toBeNull()
    expect(qkAfter.failReason).toBe('Parent run awaiting approval')
    expect(qkAfter.prUrl).toBe(parent.prUrl)
    expect(isInvalidDoneWatcherBookkeepingRun(qkAfter)).toBe(true)

    // Other watcher/approval shutdown reasons on the same no-lineage done
    // shape are also flagged so existing rows retired via dispose/replacing
    // stop blocking retry.
    const disposed = createEmptyWatcherChild(fixture, 'run-disposed')
    fixture.context.runRepo.updateStage(disposed.id, 'done', 'Watcher manager disposed')
    expect(isInvalidDoneWatcherBookkeepingRun(fixture.context.runRepo.get(disposed.id)!)).toBe(true)

    const entered = createEmptyWatcherChild(fixture, 'run-entered')
    fixture.context.runRepo.updateStage(entered.id, 'done', 'Parent run entered implement')
    expect(isInvalidDoneWatcherBookkeepingRun(fixture.context.runRepo.get(entered.id)!)).toBe(true)

    // A real newer implementation run with session/worktree/completed stages
    // is NOT flagged — it must still block stale parent actions.
    const real = fixture.context.runRepo.create({
      id: 'run-real' as Run['id'],
      taskId: parent.taskId,
      agentId: parent.agentId,
      parentRunId: parent.id,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'verify', 'review'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'real-session',
      branch: parent.branch,
      commitSha: parent.commitSha,
      prNumber: parent.prNumber,
      prUrl: parent.prUrl,
      worktreePaths: ['/tmp/worktree'],
      runtimeWorkflowProfile: parent.runtimeWorkflowProfile,
      ciStatus: 'pass',
      reviewStatus: 'pass',
      failReason: null,
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: parent.lastHeartbeat,
      heartbeatTimeoutSeconds: 60,
    })
    expect(isInvalidDoneWatcherBookkeepingRun(real)).toBe(false)

    // A no-lineage done child carrying a non-watcher failReason (e.g. a
    // genuine terminal failure) is NOT flagged — only watcher/approval
    // shutdown bookkeeping is ignored.
    const genuineFail = createEmptyWatcherChild(fixture, 'run-genuine')
    fixture.context.runRepo.updateStage(genuineFail.id, 'done', 'dead session')
    fixture.context.runRepo.updateTerminalState(genuineFail.id, 'failed')
    expect(isInvalidDoneWatcherBookkeepingRun(fixture.context.runRepo.get(genuineFail.id)!)).toBe(false)

    // Stale PR metadata on the no-lineage child does not turn into completion
    // evidence: execution-integrity still flags the historical done row.
    const integrity = evaluateRunExecutionIntegrity(qkAfter, [] as readonly Evidence[])
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.externalOutcome).toBeNull()
    expect(integrity.issues.map((issue) => issue.code)).toContain('done_run_without_lineage_or_external_outcome')
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
