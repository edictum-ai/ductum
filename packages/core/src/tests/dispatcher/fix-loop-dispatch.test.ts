import { mkdirSync, rmSync } from 'node:fs'

import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - fix loop dispatch', () => {
    it('fix-* dispatch reuses the implementation run worktree and sets parentRunId', async () => {
      const fixture = createFixture()
      // Seed an impl run with a worktree.
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      // Now create the fix task (as routeReviewResult would).
      const fixTask = createTask(fixture, { name: 'fix-P1-r1', requiredRole: 'builder' })
      await fixture.dispatcher.cycle()
      const fixRun = fixture.context.runRepo.list(fixTask.id)[0]
      expect(fixRun).toBeDefined()
      expect(fixRun?.parentRunId).toBe(implRun.id)
      expect(fixRun?.worktreePaths).toEqual(['/tmp/impl-worktree'])

      // And the spawn must have been given that same workingDir so the
      // agent actually runs in the parent worktree, not a fresh checkout.
      const spawnCall = fixture.builderHarness.adapter.spawn.mock.calls[0]
      expect(spawnCall?.[4]?.workingDir).toBe('/tmp/impl-worktree')
    })

    it('review-* dispatch reuses the implementation worktree by default', async () => {
      const fixture = createFixture()
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()
      const reviewRun = fixture.context.runRepo.list(reviewTask.id)[0]
      expect(reviewRun).toBeDefined()
      expect(reviewRun?.parentRunId).toBe(implRun.id)
      expect(reviewRun?.worktreePaths).toEqual(['/tmp/impl-worktree'])
      const spawnCall = fixture.reviewerHarness.adapter.spawn.mock.calls[0]
      expect(spawnCall?.[4]?.workingDir).toBe('/tmp/impl-worktree')
    })

    it('restores a missing inherited implementation worktree before review dispatch', async () => {
      const worktree = `/tmp/ductum-missing-review-worktree-${createId()}`
      rmSync(worktree, { recursive: true, force: true })
      const worktreeManager = {
        enabled: true,
        isGitRepo: vi.fn(() => true),
        create: vi.fn(),
        restore: vi.fn(async () => {
          mkdirSync(worktree, { recursive: true })
          return worktree
        }),
      } as unknown as WorktreeManager
      const fixture = createFixture({ resolveRepoPath: () => '/repo/personal-memory-gateway', worktreeManager })
      const { run: implRun } = seedImplRun(fixture, 'P1', {
        worktree,
        branch: 'ductum/P1-GATEWAY-PHASE-1-fykqne',
        commitSha: 'b0121a6',
      })

      createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()

      expect(worktreeManager.restore).toHaveBeenCalledWith(
        '/repo/personal-memory-gateway',
        worktree,
        'ductum/P1-GATEWAY-PHASE-1-fykqne',
        undefined,
      )
      const reviewRun = fixture.context.runRepo.list(fixture.context.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1')!.id)[0]
      expect(reviewRun?.parentRunId).toBe(implRun.id)
      expect(reviewRun?.worktreePaths).toEqual([worktree])
      expect(fixture.reviewerHarness.adapter.spawn.mock.calls[0]?.[4]?.workingDir).toBe(worktree)
      rmSync(worktree, { recursive: true, force: true })
    })

    it('routeReviewResult on FAIL dispatches a fix task and the fix reuses the parent worktree on next cycle', async () => {
      const onReadyToShip = vi.fn<(runId: never) => Promise<void>>(async () => undefined)
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
        resolveRunCompletionText: () => JSON.stringify({
          kind: 'ductum-review-result',
          verdict: 'fail',
          summary: 'found a bug in the new helper',
          findings: ['bug in the new helper'],
        }),
        onReadyToShip: onReadyToShip as never,
        maxReviewRounds: 3,
      }
      const fixture = createFixture({ postCompletion })

      // Seed impl run with a worktree.
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })

      // Create the review task, then dispatch and complete it. The
      // dispatcher sets parentRunId on the review run via resolveDispatchOptions.
      createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()
      fixture.reviewerHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
      await flush()

      // A fix task should now exist in the spec.
      const tasksAfter = fixture.context.taskRepo.list(fixture.spec.id)
      const fixTask = tasksAfter.find((t) => t.name === 'fix-P1-r1')
      expect(fixTask).toBeDefined()

      // Dispatch the fix task and verify it inherits implRun's worktree.
      await fixture.dispatcher.cycle()
      const fixRun = fixture.context.runRepo.list(fixTask!.id)[0]
      expect(fixRun?.parentRunId).toBe(implRun.id)
      expect(fixRun?.worktreePaths).toEqual(['/tmp/impl-worktree'])
    })

    it('routeReviewResult on PASS advances the root implementation run to ship', async () => {
      const onReadyToShip = vi.fn<(runId: never) => Promise<void>>(async () => undefined)
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
        resolveRunCompletionText: () => JSON.stringify({
          kind: 'ductum-review-result',
          verdict: 'pass',
          summary: 'looks good',
          findings: [],
        }),
        onReadyToShip: onReadyToShip as never,
        maxReviewRounds: 3,
      }
      const fixture = createFixture({ postCompletion })
      const { run: implRun } = seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()
      fixture.reviewerHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
      await flush()
      expect(onReadyToShip).toHaveBeenCalledWith(implRun.id)
      await vi.waitFor(() => {
        const reviewTask = fixture.context.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1')
        const reviewRun = fixture.context.runRepo.list(reviewTask!.id)[0]
        expect(reviewTask?.status).toBe('done')
        expect(reviewRun?.stage).toBe('done')
      })
    })

    it('routeReviewResult on FAIL closes the review task after dispatching a fix', async () => {
      const postCompletion: PostCompletionConfig = {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
        resolveRunCompletionText: () => JSON.stringify({
          kind: 'ductum-review-result',
          verdict: 'fail',
          summary: 'found a bug in the new helper',
          findings: ['bug in the new helper'],
        }),
        maxReviewRounds: 3,
      }
      const fixture = createFixture({ postCompletion })
      seedImplRun(fixture, 'P1', { worktree: '/tmp/impl-worktree' })
      createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()
      fixture.reviewerHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
      await flush()
      const reviewTask = fixture.context.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1')
      const reviewRun = fixture.context.runRepo.list(reviewTask!.id)[0]
      const fixTask = fixture.context.taskRepo.list(fixture.spec.id).find((t) => t.name === 'fix-P1-r1')
      expect(fixTask).toBeDefined()
      expect(reviewTask?.status).toBe('done')
      expect(reviewRun?.stage).toBe('done')
    })
})
