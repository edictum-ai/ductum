import { createFixture, createTask, describe, expect, flush, it, vi } from './shared.js'

// Regression suite for the P1 Complete Handoff Guard (issue #245).
// Live incident: P1TqLlKzD7-F linked branch/commit and called
// ductum_complete, but stayed visible as an Active Attempt forever
// because the run had no worktree on record and routeCompletedRun()
// fell through its kind=impl branch silently. These tests pin the
// fail-closed contract: a completed run with no live worker and no
// review/PR path must reach a real terminal state so the operator
// sees a Needs Attention row instead of a ghost Active Attempt.
describe('Dispatcher - completion handoff guard (issue #245)', () => {
  it('marks a completed run Needs Attention when branch+commit evidence exists but no worktree is recorded', async () => {
    // Regression: P1TqLlKzD7-F. The builder called ductum.complete and
    // linked a branch/commit, but the run had no worktreePaths on record
    // (the worktree was never created or had already been cleaned up).
    // routeCompletedRun() fell through its kind=impl branch silently and
    // runImplCompletion never ran, so the run stayed in implement with
    // completionSummary + branch + commit but no review/PR/Needs Attention
    // path. The CLI showed it as an Active Attempt forever with no live
    // child worker.
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'P1-SECURITY-AUTH-DIFF-RECOVERY' })
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    // Live shape: completion summary + branch + commit, but NO worktree.
    fixture.context.runRepo.updateCompletionSummary(run.id, 'changed X to do Y; verified by building and running tests')
    fixture.context.runRepo.updateGitArtifacts(run.id, {
      branch: 'ductum/P1-SECURITY-AUTH-DIFF-RECOVERY-P1TqLl',
      commitSha: 'dcd907b29b0a69fc10a4fa7543abff5441074ff8',
    })

    // endSession models the API /complete handler calling
    // dispatcher.endSession after recording the summary.
    await fixture.dispatcher.endSession(run.id)
    await flush()
    await flush()

    // The run must NOT stay Active. Fail-closed: terminal state reached,
    // recoverable reason recorded so the operator sees a Needs Attention
    // row instead of a ghost Active Attempt.
    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    const finalRun = fixture.context.runRepo.get(run.id)!
    expect(finalRun.stage).not.toBe('implement')
    expect(finalRun.terminalState).toBe('failed')
    expect(finalRun.recoverable).toBe(true)
    expect(finalRun.failReason).toMatch(/worktree|branch|completion|evidence/i)
    // The run must NOT have been routed to ship (no PR/merge evidence).
    expect(onReadyToShip).not.toHaveBeenCalled()
  })

  it('remains fail-closed when the harness session has already disappeared before endSession', async () => {
    // Models the live CLI shape: the worker process was already gone
    // when ductum.complete fired, so by the time endSession runs there
    // is no active session to tear down. The fallback must still route
    // the run through runImplCompletion and fail closed.
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'P1-SECURITY-AUTH-DIFF-RECOVERY' })
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateCompletionSummary(run.id, 'changed X to do Y; verified by building and running tests')
    fixture.context.runRepo.updateGitArtifacts(run.id, {
      branch: 'ductum/P1-SECURITY-AUTH-DIFF-RECOVERY-P1TqLl',
      commitSha: 'dcd907b29b0a69fc10a4fa7543abff5441074ff8',
    })

    // Simulate the harness exiting on its own with a non-'completed'
    // reason before ductum.complete fires. handleSessionEnd runs but
    // does not route post-completion because exitReason !== 'completed'.
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'killed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()

    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    const midRun = fixture.context.runRepo.get(run.id)!
    expect(midRun.terminalState).toBeNull()
    expect(midRun.stage).not.toBe('done')

    // Now ductum.complete fires — endSession with no active session.
    await fixture.dispatcher.endSession(run.id)
    await flush()
    await flush()

    const finalRun = fixture.context.runRepo.get(run.id)!
    expect(finalRun.terminalState).toBe('failed')
    expect(finalRun.recoverable).toBe(true)
    expect(finalRun.failReason).toMatch(/worktree|branch|completion|evidence/i)
    expect(onReadyToShip).not.toHaveBeenCalled()
  })

  it('does not double-fail when endSession fires twice for the same completed run', async () => {
    // Idempotency: handleSessionEnd dedups via handledSessionEnds and
    // routedPostCompletion, and failClosedMissingWorktree marks the run
    // terminal on the first call. A second endSession (e.g., from the
    // MCP client's setImmediate fallback) must not double-route or
    // overwrite the recorded reason.
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'P1-SECURITY-AUTH-DIFF-RECOVERY' })
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateCompletionSummary(run.id, 'changed X to do Y; verified by building and running tests')
    fixture.context.runRepo.updateGitArtifacts(run.id, {
      branch: 'ductum/P1-SECURITY-AUTH-DIFF-RECOVERY-P1TqLl',
      commitSha: 'dcd907b29b0a69fc10a4fa7543abff5441074ff8',
    })

    await fixture.dispatcher.endSession(run.id)
    await flush()
    const firstFinal = fixture.context.runRepo.get(run.id)!
    expect(firstFinal.terminalState).toBe('failed')
    const firstReason = firstFinal.failReason

    // Second nudge from the API client's setImmediate fallback path.
    await fixture.dispatcher.endSession(run.id)
    await flush()

    const secondFinal = fixture.context.runRepo.get(run.id)!
    expect(secondFinal.terminalState).toBe('failed')
    expect(secondFinal.failReason).toBe(firstReason)
    expect(onReadyToShip).not.toHaveBeenCalled()
  })
})
