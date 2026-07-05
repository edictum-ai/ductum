import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createTask, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - completion routing', () => {
  it('uses explicit assignment before requiredRole matching', async () => {
    const fixture = createFixture()
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id, requiredRole: 'reviewer' })
    await fixture.dispatcher.cycle()
    expect(fixture.context.runRepo.list(task.id)[0]?.agentId).toBe(fixture.builder.id)
    expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
  })

  it('matches reviewer tasks to reviewer agents and skips busy agents', async () => {
    const fixture = createFixture()
    const reviewerTask = createTask(fixture, { requiredRole: 'reviewer' })
    const builderTaskA = createTask(fixture)
    const builderTaskB = createTask(fixture)
    const result = await fixture.dispatcher.cycle()
    expect(fixture.context.runRepo.list(reviewerTask.id)[0]?.agentId).toBe(fixture.reviewer.id)
    expect(result.tasksDispatched).toEqual([reviewerTask.id, builderTaskA.id])
    expect(result.errors).toEqual([])
    expect(fixture.context.taskRepo.get(builderTaskB.id)?.status).toBe('ready')
  })

  it('returns an empty result when nothing is ready', async () => {
    const fixture = createFixture()
    await expect(fixture.dispatcher.cycle()).resolves.toEqual({ tasksEvaluated: 0, tasksDispatched: [], errors: [] })
  })

  it('marks crashed sessions stalled and records final runtime usage', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.builderHarness.sessions[0]?.done.resolve({ exitReason: 'crashed', tokensIn: 7, tokensOut: 3, costUsd: 0.5 })
    await flush()
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run?.terminalState).toBe('stalled')
    expect(run?.tokensIn).toBe(7)
    expect(run?.tokensOut).toBe(3)
    expect(run?.costUsd).toBeCloseTo(0.5, 8)
  })

  it('routes completed review tasks through review result handling', async () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    const routeReviewResult = vi.spyOn(fixture.dispatcher.router, 'runReviewCompletion').mockResolvedValue(undefined)
    const runPostCompletionPipeline = vi.spyOn(fixture.dispatcher.router, 'runImplCompletion').mockResolvedValue(undefined)
    await fixture.dispatcher.cycle()
    fixture.reviewerHarness.sessions[0]?.done.resolve({ exitReason: 'completed', tokensIn: 7, tokensOut: 3, costUsd: 0.5 })
    await flush()
    expect(routeReviewResult).toHaveBeenCalledTimes(1)
    expect(runPostCompletionPipeline).not.toHaveBeenCalled()
    routeReviewResult.mockRestore()
    runPostCompletionPipeline.mockRestore()
  })

  it('routes bakeoff blind-review tasks through blind review handling', async () => {
    const fixture = createFixture()
    fixture.context.specRepo.delete(fixture.spec.id)
    fixture.context.specRepo.create({
      id: fixture.spec.id,
      projectId: fixture.project.id,
      name: fixture.spec.name,
      status: fixture.spec.status,
      strategy: 'best_of_n',
      document: 'Compare candidates.',
      maxFixIterations: fixture.spec.maxFixIterations,
    })
    createTask(fixture, {
      name: 'blind-review',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const routeBlindReview = vi.spyOn(fixture.dispatcher.router, 'runBlindReviewCompletion').mockResolvedValue(undefined)
    const routeReviewResult = vi.spyOn(fixture.dispatcher.router, 'runReviewCompletion').mockResolvedValue(undefined)
    const runPostCompletionPipeline = vi.spyOn(fixture.dispatcher.router, 'runImplCompletion').mockResolvedValue(undefined)
    await fixture.dispatcher.cycle()
    fixture.reviewerHarness.sessions[0]?.done.resolve({ exitReason: 'completed', tokensIn: 7, tokensOut: 3, costUsd: 0.5 })
    await flush()
    expect(routeBlindReview).toHaveBeenCalledTimes(1)
    expect(routeReviewResult).not.toHaveBeenCalled()
    expect(runPostCompletionPipeline).not.toHaveBeenCalled()
    routeBlindReview.mockRestore()
    routeReviewResult.mockRestore()
    runPostCompletionPipeline.mockRestore()
  })

  it('routes completed fix tasks through routeFixResult (not runPostCompletionPipeline)', async () => {
    const fixture = createFixture()
    const task = createTask(fixture, { name: 'fix-P1-r1', requiredRole: 'builder' })
    const routeReviewResult = vi.spyOn(fixture.dispatcher.router, 'runReviewCompletion').mockResolvedValue(undefined)
    const routeFixResult = vi.spyOn(fixture.dispatcher.router, 'runFixCompletion').mockResolvedValue(undefined)
    const runPostCompletionPipeline = vi.spyOn(fixture.dispatcher.router, 'runImplCompletion').mockResolvedValue(undefined)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]
    fixture.context.runRepo.updateWorktreePaths(run!.id, ['/tmp/fix-worktree'])
    fixture.builderHarness.sessions[0]?.done.resolve({ exitReason: 'completed', tokensIn: 7, tokensOut: 3, costUsd: 0.5 })
    await flush()
    expect(routeFixResult).toHaveBeenCalledTimes(1)
    expect(runPostCompletionPipeline).not.toHaveBeenCalled()
    expect(routeReviewResult).not.toHaveBeenCalled()
    routeReviewResult.mockRestore()
    routeFixResult.mockRestore()
    runPostCompletionPipeline.mockRestore()
  })

  it('forces post-completion routing if endSession teardown never yields a completion event', async () => {
    vi.useFakeTimers()
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.adapter.kill.mockImplementationOnce(async () => undefined)
    await fixture.dispatcher.endSession(run.id)
    await vi.advanceTimersByTimeAsync(1_001)
    await flush()
    await flush()
    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
  })

  it('forces post-completion routing even if endSession teardown throws', async () => {
    vi.useFakeTimers()
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.adapter.kill.mockRejectedValueOnce(new Error('teardown failed'))
    await fixture.dispatcher.endSession(run.id)
    await vi.advanceTimersByTimeAsync(1_001)
    await flush()
    await flush()
    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
  })

  it('forces post-completion routing when the harness session has already disappeared', async () => {
    // Regression: runs 7OqZDPrgAhLr and Qr5o9e55D-Pb called ductum.complete
    // but remained in implement because the harness session was already gone
    // when endSession was called, and the fallback exited early on
    // !activeSessions.has(runId) instead of checking the run's actual state.
    vi.useFakeTimers()
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])

    // Simulate the harness exiting on its own with a non-'completed' reason
    // (e.g. the process was killed externally). handleSessionEnd processes
    // this but does NOT route post-completion because exitReason !==
    // 'completed'. 'killed' is used because it doesn't trigger stall
    // handling (only 'crashed'/'timeout' do) yet is not 'completed'.
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'killed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()

    // The run is still in a non-terminal, non-done stage with no active session.
    // (Runs start at 'understand'; the exact stage doesn't matter for the bug.)
    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    const midRun = fixture.context.runRepo.get(run.id)!
    expect(midRun.terminalState).toBeNull()
    expect(midRun.stage).not.toBe('done')

    // Now ductum.complete fires — endSession is called with no active session.
    // The fix ensures the fallback is still scheduled and fires.
    await fixture.dispatcher.endSession(run.id)
    await vi.advanceTimersByTimeAsync(1_001)
    await flush()
    await flush()
    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
  })

  it('does not double-route post-completion when handleSessionEnd already processed the run', async () => {
    // Idempotency: if handleSessionEnd already successfully routed
    // post-completion (handledSessionEnds has the runId), the fallback
    // must not fire again.
    vi.useFakeTimers()
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])

    // Normal completion path: harness exits with 'completed', handleSessionEnd
    // routes post-completion, adds to handledSessionEnds.
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()

    // handleSessionEnd already processed it.
    expect(onReadyToShip).toHaveBeenCalledTimes(1)

    // Now endSession fires (from the API's setImmediate callback).
    // The fallback is scheduled but must NOT double-route.
    await fixture.dispatcher.endSession(run.id)
    await vi.advanceTimersByTimeAsync(1_001)
    await flush()
    await flush()
    expect(onReadyToShip).toHaveBeenCalledTimes(1)
  })

  it('kills stalled sessions and stops watchers', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.builderHarness.adapter.isAlive.mockResolvedValue(false)
    fixture.nowRef.value = '2026-04-04T12:03:00.000Z'
    await fixture.dispatcher.cycle()
    await flush()
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run?.terminalState).toBe('stalled')
    expect(fixture.builderHarness.adapter.kill).toHaveBeenCalledWith('claude-session-1')
    expect((fixture.watcherManager as unknown as { stopWatchers: ReturnType<typeof vi.fn> }).stopWatchers).toHaveBeenCalledWith(run!.id, 'Run stalled')
  })

  it('paused-max-turns freezes the run (resumable) with max_turns_paused reason and preserves worktree', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'paused-max-turns',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 5,
      pauseDetail: { detail: 'hit 200 of 200 agent turns', cap: 200 },
    })
    await flush()
    const run = fixture.context.runRepo.list(task.id)[0]
    // design/04 §5: policy limits freeze+notify+resume, not terminal-fail.
    expect(run?.terminalState).toBe('frozen')
    expect(run?.failReason).toMatch(/^max_turns_paused/)
    expect(run?.recoverable).toBe(true)
  })

  it('paused-cost-budget freezes the run (resumable) with cost_budget_paused reason and preserves worktree', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'paused-cost-budget',
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: 30,
      pauseDetail: { detail: 'SDK reported cost cap reached at $30 (cap $30)', cap: 30 },
    })
    await flush()
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run?.terminalState).toBe('frozen')
    expect(run?.failReason).toMatch(/^cost_budget_paused/)
    expect(run?.recoverable).toBe(true)
  })
})
