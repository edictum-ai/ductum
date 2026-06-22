import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - fix loop review', () => {
    it('routeFixResult does not parse the fix output as PASS/FAIL and dispatches a fresh review', async () => {
      // resolveReviewerAgent closure captures fixture by reference — safe
      // because it fires during routeFixResult, well after fixture exists.
      let fixtureRef: ReturnType<typeof createFixture>
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => fixtureRef.reviewer.id as never,
        // Note: completion text is a plain description, not PASS/FAIL.
        resolveRunCompletionText: () => 'Replaced the null handler with a guard',
        maxReviewRounds: 3,
      }
      const fixture = createFixture({ postCompletion })
      fixtureRef = fixture

      // Seed impl run + fix run directly (skip dispatch so we can call
      // routeFixResult synchronously and await its full async chain).
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      const fixTask = createTask(fixture, { name: 'fix-P1-r1', requiredRole: 'builder' })
      const fixRun = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: fixTask.id,
        agentId: fixture.builder.id,
        parentRunId: implRun.id,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'fix-session',
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

      // Drive the router's fix-completion path directly and await the
      // whole chain (including the subprocess-based collectDiff which
      // returns '(failed to ...)' for non-existent paths).
      await fixture.dispatcher.router.runFixCompletion(fixRun)

      // A fresh review task must exist on the spec, with round-2 name.
      const tasksAfter = fixture.context.taskRepo.list(fixture.spec.id)
      const reviewRound2 = tasksAfter.find((t) => t.name === 'review-P1-r2')
      expect(reviewRound2).toBeDefined()

      // The fix run itself was not marked failed based on parsing.
      const fixRunAfter = fixture.context.runRepo.get(fixRun.id)
      expect(fixRunAfter?.terminalState).toBeNull()
    })

    it('escalates the root implementation run after the max fix iterations cap and closes stale lineage rows', async () => {
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
        resolveRunCompletionText: () => JSON.stringify({
          kind: 'ductum-review-result',
          verdict: 'fail',
          summary: 'still broken',
          findings: ['still broken'],
        }),
        maxReviewRounds: 2, // cap at 2 fix iterations
      }
      const fixture = createFixture({ postCompletion })

      // Seed impl run and manually build a fix chain: impl → fix-r1 → fix-r2
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      const fixTaskR1 = createTask(fixture, { name: 'fix-P1-r1', requiredRole: 'builder' })
      const fixRunR1 = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: fixTaskR1.id,
        agentId: fixture.builder.id,
        parentRunId: implRun.id,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'fix-r1-session',
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
      const fixTaskR2 = createTask(fixture, { name: 'fix-P1-r2', requiredRole: 'builder' })
      const fixRunR2 = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: fixTaskR2.id,
        agentId: fixture.builder.id,
        parentRunId: fixRunR1.id,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'fix-r2-session',
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
      const unrelatedTask = createTask(fixture, { name: 'P2', status: 'active' })
      const unrelatedRun = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: unrelatedTask.id,
        agentId: fixture.builder.id,
        parentRunId: null,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'unrelated-session',
        branch: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: ['/tmp/unrelated-worktree'],
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

      // Simulate a review run that parents onto fix-r2 and returns FAIL.
      const reviewTask = createTask(fixture, { name: 'review-P1-r3', requiredRole: 'reviewer' })
      const reviewRun = fixture.context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: reviewTask.id,
        agentId: fixture.reviewer.id,
        parentRunId: fixRunR2.id,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: 'review-r3-session',
        branch: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
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

      // Call the router's review-completion path directly as if the
      // review just completed.
      await fixture.dispatcher.router.runReviewCompletion(reviewRun)

      // The root impl run must be escalated, no fix-r3 task created.
      const tasksAfter = fixture.context.taskRepo.list(fixture.spec.id)
      const fixR3 = tasksAfter.find((t) => t.name === 'fix-P1-r3')
      expect(fixR3).toBeUndefined()
      const rootAfter = fixture.context.runRepo.get(implRun.id)
      expect(rootAfter?.terminalState).toBe('failed')
      expect(rootAfter?.failReason).toMatch(/max_review_iterations/)
      expect(fixture.context.runRepo.get(fixRunR1.id)?.terminalState).toBe('failed')
      expect(fixture.context.runRepo.get(fixRunR2.id)?.terminalState).toBe('failed')
      expect(fixture.context.taskRepo.get(fixTaskR1.id)?.status).toBe('failed')
      expect(fixture.context.taskRepo.get(fixTaskR2.id)?.status).toBe('failed')
      expect(fixture.context.runRepo.get(reviewRun.id)?.stage).toBe('done')
      expect(fixture.context.taskRepo.get(reviewTask.id)?.status).toBe('done')
      expect(fixture.context.runRepo.get(unrelatedRun.id)?.terminalState).toBeNull()
      expect(fixture.context.taskRepo.get(unrelatedTask.id)?.status).toBe('active')
    })

})
