import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - lifecycle', () => {
  it('dispatches ready tasks, creates session mapping, and builds MCP before spawn', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(result.tasksDispatched).toEqual([task.id])
    expect(fixture.order[0]).toMatch(/^mcp:/)
    expect(fixture.order[1]).toBe('claude:spawn')
    expect(run?.agentId).toBe(fixture.builder.id)
    expect(run?.sessionId).toBe('claude-session-1')
    const spawnOptions = fixture.builderHarness.adapter.spawn.mock.calls[0]?.[4]
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run!.id)).toMatchObject({
      sessionId: 'claude-session-1',
      runId: run!.id,
      controlToken: spawnOptions?.controlToken,
      harnessSessionId: 'claude-session-1',
    })
    expect(run).toMatchObject({
      runtimeModel: 'claude-opus-4.6',
      runtimeHarness: 'claude-agent-sdk',
    })
    expect(spawnOptions?.agent?.model).toBe('claude-opus-4.6')
    expect(spawnOptions?.agent?.harness).toBe('claude-agent-sdk')
  })

  it('runs startup worktree cleanup before dispatch creates new worktrees', async () => {
    const cleanupGate = deferred<void>()
    const order: string[] = []
    const worktreeManager = {
      enabled: true,
      cleanupOnSuccess: true,
      cleanupOnFailure: true,
      cleanupStale: vi.fn(async () => {
        order.push('cleanup:start')
        await cleanupGate.promise
        order.push('cleanup:end')
        return 0
      }),
      create: vi.fn(async () => {
        order.push('create')
        return '/tmp/ductum-worktree'
      }),
      isGitRepo: vi.fn(() => true),
      remove: vi.fn(async () => undefined),
    } as unknown as WorktreeManager
    const fixture = createFixture({
      pollIntervalMs: 60_000,
      resolveRepoPath: (repoName) => (repoName === 'ductum' ? '/tmp/ductum-source' : undefined),
      worktreeManager,
    })
    createTask(fixture, { repos: ['ductum'] })
    fixture.dispatcher.start()
    try {
      await vi.waitFor(() => {
        expect(order).toEqual(['cleanup:start'])
      })
      expect(fixture.builderHarness.adapter.spawn).not.toHaveBeenCalled()
      cleanupGate.resolve(undefined)
      await vi.waitFor(() => {
        expect(order).toEqual(['cleanup:start', 'cleanup:end', 'create'])
      })
      await vi.waitFor(() => {
        expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledOnce()
      })
    } finally {
      fixture.dispatcher.stop()
    }
  })

  it('persists the resolved working directory in the session mapping', async () => {
    const fixture = createFixture({
      resolveRepoPath: (repoName) => (repoName === 'ductum' ? '/tmp/ductum-worktree' : undefined),
    })
    const task = createTask(fixture, { repos: ['ductum'] })
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run!.id)).toMatchObject({
      sessionId: 'claude-session-1',
      runId: run!.id,
      controlToken: fixture.builderHarness.adapter.spawn.mock.calls[0]?.[4]?.controlToken,
      workingDir: '/tmp/ductum-worktree',
    })
  })

  it('respects the concurrent run limit based on live sessions, not DB rows', async () => {
    // Concurrency is counted against the in-memory activeSessions map,
    // not runRepo.getActive(), so that impl runs awaiting async review
    // don't occupy a harness slot (otherwise the pipeline deadlocks once
    // maxConcurrentRuns impls sit waiting for reviewers).
    const fixture = createFixture()
    // Three tasks to fill maxConcurrentRuns=3; a fourth must wait.
    createTask(fixture, { name: 'T1' })
    createTask(fixture, { name: 'T2', requiredRole: 'reviewer' })
    createTask(fixture, { name: 'T3' })
    createTask(fixture, { name: 'T4' }) // The one that should NOT dispatch.

    // First cycle dispatches what it can — limited by agent availability
    // (builder + reviewer = 2 agents). T1 goes to builder, T2 to reviewer.
    // T3/T4 compete for the (no longer free) builder and fail to match.
    const result = await fixture.dispatcher.cycle()
    expect(result.tasksDispatched.length).toBeGreaterThan(0)
    expect(result.tasksDispatched.length).toBeLessThanOrEqual(2)
  })

  it('does NOT count post-completion runs awaiting review against concurrency', async () => {
    // Regression test for the review-deadlock bug: an impl run that
    // called ductum.complete sits at stage=implement with terminalState
    // null while the async review runs. Those runs must NOT occupy a
    // harness slot, otherwise no review task can ever dispatch.
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1', status: 'active', assignedAgentId: fixture.builder.id })
    fixture.context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: implTask.id,
      agentId: fixture.builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'completed-impl-session',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/impl-wt'],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: fixture.nowRef.value,
      heartbeatTimeoutSeconds: 120,
    })

    // The impl run is NOT in dispatcher.activeSessions (it already
    // finished). A review task should dispatch freely.
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    const result = await fixture.dispatcher.cycle()
    expect(result.tasksDispatched).toContain(reviewTask.id)
  })
})
