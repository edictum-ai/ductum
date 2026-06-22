import { createFixture, createId, createTask, describe, expect, flush, it, vi } from './shared.js'
import { afterEach } from 'vitest'
import { COMPLETION_RELEASE_TIMEOUT_MS } from '../../dispatcher-types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Dispatcher - completion teardown', () => {
  it('records cleanup failure before routing completed Podman runs', async () => {
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      recordEvidence: true,
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const release = vi.spyOn(fixture.dispatcher as never, 'releaseSession')
      .mockRejectedValueOnce(new Error('podman cleanup failed for container c1: timeout'))
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 7,
      tokensOut: 3,
      costUsd: 0.5,
    })
    await flush()
    await flush()

    expect(release).toHaveBeenCalledTimes(1)
    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: 'failed',
      pendingApproval: false,
    })
    expect(fixture.context.runRepo.get(run.id)?.failReason).toContain('sandbox_cleanup_failed: podman cleanup failed')
    expect(fixture.context.evidenceRepo.list(run.id).some((entry) =>
      entry.payload.kind === 'sandbox.cleanup_failure'
      && String(entry.payload.reason).includes('podman cleanup failed'),
    )).toBe(true)
  })

  it('keeps cleanup failure visible if completion handling is invoked again', async () => {
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    vi.spyOn(fixture.dispatcher as never, 'releaseSession')
      .mockRejectedValueOnce(new Error('podman rm failed'))
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()
    await (fixture.dispatcher as unknown as {
      handleSessionEnd(runId: typeof run.id, result: { exitReason: 'completed'; tokensIn: number; tokensOut: number; costUsd: number }): Promise<void>
    }).handleSessionEnd(run.id, { exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.context.runRepo.get(run.id)?.terminalState).toBe('failed')
    expect(fixture.context.runRepo.get(run.id)?.failReason).toContain('sandbox_cleanup_failed: podman rm failed')
  })

  it('fails visibly instead of ghosting when completion release never settles', async () => {
    vi.useFakeTimers()
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      recordEvidence: true,
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    vi.spyOn(fixture.dispatcher as never, 'releaseSession')
      .mockImplementationOnce(async () => await new Promise<never>(() => undefined))
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await vi.advanceTimersByTimeAsync(COMPLETION_RELEASE_TIMEOUT_MS + 1)
    await flush()

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: 'failed',
      pendingApproval: false,
    })
    expect(fixture.context.runRepo.get(run.id)?.failReason).toContain('completion release timed out')
    expect(fixture.context.evidenceRepo.list(run.id).some((entry) =>
      entry.payload.kind === 'sandbox.cleanup_failure'
      && String(entry.payload.reason).includes('completion release timed out'),
    )).toBe(true)
  })

  it('releases successfully before normal completion routing and clears active session state', async () => {
    const order: string[] = []
    const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => { order.push('route') })
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    vi.spyOn(fixture.dispatcher as never, 'releaseSession').mockImplementationOnce(async () => {
      order.push('release')
    })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()

    expect(order).toEqual(['release', 'route'])
    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
  })

  it('keeps host-mode completion release behavior unchanged', async () => {
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
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()

    expect(fixture.dispatcher.hasActiveSession(run.id)).toBe(false)
    expect(fixture.context.runRepo.get(run.id)?.terminalState).toBeNull()
    expect(fixture.context.runRepo.get(run.id)?.failReason).toBeNull()
  })

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
        resolveRunCompletionText: () => JSON.stringify({
          kind: 'ductum-review-result',
          verdict: 'fail',
          summary: 'blocker still present',
          findings: ['blocker still present'],
        }),
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
