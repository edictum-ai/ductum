import { createFixture, createId, createTask, describe, expect, flush, it, vi } from './shared.js'

describe('Dispatcher - completion teardown', () => {
  it('routes implementation completion when teardown reports killed after ductum.complete', async () => {
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
    fixture.builderHarness.adapter.kill.mockImplementationOnce(async (sessionId) => {
      const session = fixture.builderHarness.sessions.find((item) => item.sessionId === sessionId)
      session?.done.resolve({
        exitReason: 'killed',
        tokensIn: 7,
        tokensOut: 3,
        costUsd: 0.5,
      })
    })

    await fixture.dispatcher.endSession(run.id)
    await flush()
    await flush()

    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
    expect(onReadyToShip).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_001)
    await flush()
    expect(onReadyToShip).toHaveBeenCalledTimes(1)
  })

  it('routes review completion when teardown reports killed after ductum.complete', async () => {
    vi.useFakeTimers()
    const onReviewResult = vi.fn(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => 'FAIL: blocker still present',
        onReviewResult: onReviewResult as never,
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'active' })
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
      sessionId: 'impl-session',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/impl-worktree'],
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
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    await fixture.dispatcher.cycle()
    const reviewRun = fixture.context.runRepo.list(reviewTask.id)[0]!
    fixture.reviewerHarness.adapter.kill.mockImplementationOnce(async (sessionId) => {
      const session = fixture.reviewerHarness.sessions.find((item) => item.sessionId === sessionId)
      session?.done.resolve({
        exitReason: 'killed',
        tokensIn: 7,
        tokensOut: 3,
        costUsd: 0.5,
      })
    })

    await fixture.dispatcher.endSession(reviewRun.id)
    await flush()
    await flush()

    expect(onReviewResult).toHaveBeenCalledWith(
      reviewRun.id,
      expect.objectContaining({ verdict: 'fail', passed: false }),
    )
    expect(fixture.context.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.context.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.context.taskRepo.list(fixture.spec.id).some((task) => task.name === 'fix-P1-r1')).toBe(true)
  })
})
