import { createFixture, createRun, createTask, describe, expect, it, structuredReview, vi, type RunId } from './shared.js'

describe('PostCompletionRouter repair review task routing', () => {
  it('routes review-fix repair task reviews to the matching fix run', async () => {
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => structuredReview('pass', 'repair review passed'),
      },
    })
    const implTask = createTask(fixture, { name: 'P3', status: 'active' })
    const implRun = createRun(fixture, implTask, { stage: 'done', worktreePaths: ['/tmp/root-wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P3-r11', status: 'active', requiredRole: 'builder' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, stage: 'done', worktreePaths: ['/tmp/fix-wt'] })
    const reviewTask = createTask(fixture, { name: 'review-fix-P3-r11', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(implRun.id)
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(fixRun.id)?.stage).toBe('done')
  })
})
