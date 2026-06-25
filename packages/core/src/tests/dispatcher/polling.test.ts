import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - polling and backpressure', () => {
  it('spawns watchers when a run enters waiting-for-ci via stage_changed event', async () => {
    vi.useFakeTimers()
    const fixture = createFixture({ realWatcherManager: true })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id, status: 'active' })
    const run = fixture.context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: fixture.builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-1',
      branch: 'feat/p10',
      commitSha: 'abc123',
      prNumber: 7,
      prUrl: 'https://github.com/acartag7/ductum/pull/7',
      worktreePaths: null,
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

    // WatcherManager listens for run.stage_changed events with to === 'ship'
    fixture.eventEmitter.emit({ type: 'run.stage_changed', runId: run.id, from: 'implement', to: 'ship' })
    expect((fixture.watcherManager as WatcherManager).activeCount()).toBe(1)
    ;(fixture.watcherManager as WatcherManager).dispose()
  })

  it('start and stop control the polling loop', async () => {
    vi.useFakeTimers()
    const fixture = createFixture({ pollIntervalMs: 500 })
    const cycleSpy = vi.spyOn(fixture.dispatcher, 'cycle')
    fixture.dispatcher.start()
    await vi.advanceTimersByTimeAsync(1_100)
    fixture.dispatcher.stop()
    const callsAtStop = cycleSpy.mock.calls.length
    await vi.advanceTimersByTimeAsync(1_100)
    expect(cycleSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(fixture.dispatcher.status().running).toBe(false)
    expect(cycleSpy.mock.calls.length).toBe(callsAtStop)
  })

  it('does not log busy-agent backpressure as an operator error', async () => {
    vi.useFakeTimers()
    const fixture = createFixture({ pollIntervalMs: 500 })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Two builder tasks but only one builder agent. The second task should
    // stay ready until capacity frees up; it is not an operator error.
    const first = createTask(fixture)
    const surplus = createTask(fixture)
    fixture.dispatcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await flush()
    expect(fixture.context.taskRepo.get(first.id)?.status).toBe('active')
    expect(fixture.context.taskRepo.get(surplus.id)?.status).toBe('ready')
    expect(errorSpy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes(surplus.id))).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(errorSpy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes(surplus.id))).toBe(false)
    fixture.dispatcher.stop()
    errorSpy.mockRestore()
  })

  it('dispatches a task once its eligible busy agent frees up', async () => {
    vi.useFakeTimers()
    const fixture = createFixture({ pollIntervalMs: 500 })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const taskA = createTask(fixture)
    const taskB = createTask(fixture)
    fixture.dispatcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await flush()
    const dispatchedId = [taskA.id, taskB.id].find((id) => fixture.context.taskRepo.get(id)?.status === 'active')!
    const waitingId = [taskA.id, taskB.id].find((id) => id !== dispatchedId)!
    expect(dispatchedId).toBeDefined()
    expect(fixture.context.taskRepo.get(waitingId)?.status).toBe('ready')

    // Complete the dispatched session so the agent frees up
    const session = fixture.builderHarness.sessions[0]!
    session.done.resolve({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await flush()

    // Next tick: the waiting task gets dispatched. No error is logged.
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    const run = fixture.context.runRepo.list(waitingId as Task['id'])[0]
    expect(run?.agentId).toBe(fixture.builder.id)
    expect(errorSpy.mock.calls.some((args) => typeof args[0] === 'string' && args[0].includes(waitingId))).toBe(false)
    fixture.dispatcher.stop()
    errorSpy.mockRestore()
  })

  it('clears a persisted agent-busy skip when the queued task dispatches', async () => {
    const fixture = createFixture()
    const first = createTask(fixture)
    const waiting = createTask(fixture)

    await fixture.dispatcher.cycleOnce()
    expect(fixture.context.taskRepo.get(first.id)?.status).toBe('active')
    expect(fixture.context.taskRepo.get(waiting.id)?.status).toBe('ready')
    expect(fixture.context.taskDispatchSkipRepo.get(waiting.id)).toMatchObject({
      reason: 'agent-busy',
      detail: 'eligible agent busy in another run',
    })

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()

    const result = await fixture.dispatcher.cycleOnce()
    expect(result.tasksDispatched).toContain(waiting.id)
    expect(fixture.context.taskDispatchSkipRepo.get(waiting.id)).toBeNull()
  })
})
