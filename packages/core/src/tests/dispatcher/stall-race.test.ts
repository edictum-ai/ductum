import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - stall races', () => {
  describe('stall race condition (P0)', () => {
    it('does not mark a live adapter session stalled when the heartbeat timer lags', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      const run = fixture.context.runRepo.list(task.id)[0]!
      fixture.nowRef.value = '2026-04-04T12:03:00.000Z'
      await fixture.dispatcher.cycle()
      const refreshed = fixture.context.runRepo.get(run.id)!
      expect(refreshed.terminalState).toBeNull()
      expect(fixture.builderHarness.adapter.isAlive).toHaveBeenCalledWith('claude-session-1')
      expect(fixture.builderHarness.adapter.kill).not.toHaveBeenCalled()
    })

    it('keeps a long-running session alive as long as heartbeats arrive', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      const run = fixture.context.runRepo.list(task.id)[0]!

      // Simulate 10 minutes of activity. Each minute the agent pings its
      // heartbeat via the state machine, and the dispatcher polls for stalls.
      // With a 120s timeout, the run must stay alive the entire time.
      for (let minute = 1; minute <= 10; minute += 1) {
        fixture.nowRef.value = `2026-04-04T12:${String(minute).padStart(2, '0')}:00.000Z`
        fixture.stateMachine.heartbeat(run.id)
        await fixture.dispatcher.cycle()
      }
      const refreshed = fixture.context.runRepo.get(run.id)!
      expect(refreshed.terminalState).toBeNull()
      expect(fixture.builderHarness.adapter.kill).not.toHaveBeenCalled()
    })

    it('does not mark a run stalled while its post-completion pipeline is in flight', async () => {
      let release!: () => void
      const hold = new Promise<void>((resolve) => { release = resolve })
      const onReadyToShip = vi.fn<(runId: string) => Promise<void>>(async () => {
        await hold
      })
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        // No reviewer → pipeline routes straight to onReadyToShip, which hangs.
        onReadyToShip: onReadyToShip as never,
      }
      const fixture = createFixture({ postCompletion })
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      const run = fixture.context.runRepo.list(task.id)[0]!
      // Simulate an agent that wrote work to a worktree before completing.
      fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/long-running-worktree'])

      // The session finishes successfully. handleSessionEnd fires and
      // enters runPostCompletionPipeline → onReadyToShip, which blocks.
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0,
      })
      await flush()
      expect(onReadyToShip).toHaveBeenCalledTimes(1)

      // Now advance well past the heartbeat timeout. The stall detector
      // would normally mark this run stalled — but the finishingRuns guard
      // must make it skip runs whose post-completion pipeline is running.
      fixture.nowRef.value = '2026-04-04T12:15:00.000Z'
      await fixture.dispatcher.cycle()
      const midPipeline = fixture.context.runRepo.get(run.id)!
      expect(midPipeline.terminalState).toBeNull()
      expect(fixture.builderHarness.adapter.kill).not.toHaveBeenCalled()

      // Releasing post-completion lets the pipeline finish normally.
      release()
      await flush()
      await flush()
    })

    it('still marks a session that crashes mid-pipeline as stalled', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      // The underlying session promise rejects — the dispatcher routes the
      // error through handleSessionEnd with exitReason='crashed'.
      const session = fixture.builderHarness.sessions[0]!
      session.done.resolve({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]!
      expect(run.terminalState).toBe('stalled')
      // finishingRuns must have been cleared in the finally block so a
      // subsequent stall check isn't permanently suppressed.
      fixture.nowRef.value = '2026-04-04T12:10:00.000Z'
      await fixture.dispatcher.cycle()
      const after = fixture.context.runRepo.get(run.id)!
      expect(after.terminalState).toBe('stalled')
    })

    it('auto-closes a stale ended run once no live session remains', async () => {
      const fixture = createFixture()
      const task = createTask(fixture, { status: 'active', assignedAgentId: fixture.builder.id })
      const run = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: fixture.builder.id,
        parentRunId: null,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'ended-session',
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
        lastHeartbeat: '2026-04-04T12:00:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      fixture.nowRef.value = '2026-04-04T12:30:00.000Z'
      await fixture.dispatcher.cycle()
      const refreshed = fixture.context.runRepo.get(run.id)!
      expect(refreshed.terminalState).toBe('stalled')
      expect(refreshed.failReason).toBe('stale_slot_gc')
    })

    it('does not auto-close a completed impl run while downstream review work exists', async () => {
      const fixture = createFixture()
      const task = createTask(fixture, { name: 'P1', status: 'active', assignedAgentId: fixture.builder.id })
      const run = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: fixture.builder.id,
        parentRunId: null,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'completed-impl-session',
        branch: 'ductum/P1-impl',
        commitSha: 'abc123',
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
        lastHeartbeat: '2026-04-04T12:00:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })
      createTask(fixture, {
        name: 'review-P1',
        status: 'ready',
        requiredRole: 'reviewer',
        assignedAgentId: fixture.reviewer.id,
      })

      fixture.nowRef.value = '2026-04-04T12:30:00.000Z'
      await fixture.dispatcher.cycle()

      const refreshed = fixture.context.runRepo.get(run.id)!
      expect(refreshed.terminalState).toBeNull()
      expect(refreshed.failReason).toBeNull()
      expect(fixture.context.taskRepo.get(task.id)?.status).toBe('active')
    })

    it('honors the heartbeatTimeoutSeconds override from config', async () => {
      const fixture = createFixture()
      // Manually build a dispatcher with a custom heartbeatTimeoutSeconds.
      const context = fixture.context
      const customTimeout = 600
      // The config is captured in run.heartbeatTimeoutSeconds at dispatch.
      const dispatcher = new Dispatcher(
        new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, fixture.eventEmitter),
        context.runRepo,
        context.taskRepo,
        context.agentRepo,
        context.projectAgentRepo,
        context.specRepo,
        context.projectRepo,
        fixture.stateMachine,
        fixture.watcherManager,
        context.sessionRunMappingRepo,
        new Map([
          ['claude-agent-sdk', fixture.builderHarness.adapter],
          ['vercel-ai', fixture.reviewerHarness.adapter],
        ]),
        fixture.eventEmitter,
        {
          heartbeatTimeoutSeconds: customTimeout,
          now: () => new Date(fixture.nowRef.value),
          createMcpServer: async () => ({ close: vi.fn() }),
        },
      )
      const task = createTask(fixture)
      await dispatcher.cycle()
      const run = context.runRepo.list(task.id)[0]!
      expect(run.heartbeatTimeoutSeconds).toBe(customTimeout)
    })
  })
})
