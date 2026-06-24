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

  it('routes parentless review-fix reviews to imported fix tasks without requiredRole', async () => {
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => structuredReview('pass', 'imported repair review passed'),
      },
    })
    const implTask = createTask(fixture, { name: 'P3-AUTO-APPROVAL-POLICY', status: 'active' })
    const implRun = createRun(fixture, implTask, { stage: 'done', worktreePaths: ['/tmp/root-wt'] })
    const fixTask = createTask(fixture, {
      name: 'fix-P3-AUTO-APPROVAL-POLICY-r11',
      status: 'active',
      requiredRole: null,
    })
    const fixRun = createRun(fixture, fixTask, {
      parentRunId: implRun.id,
      stage: 'done',
      worktreePaths: ['/tmp/fix-wt'],
    })
    const reviewTask = createTask(fixture, {
      name: 'review-fix-P3-AUTO-APPROVAL-POLICY-r11',
      requiredRole: 'reviewer',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(implRun.id)
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(fixRun.id)?.stage).toBe('done')
  })

  it('fails the completed review loudly when the original task is missing', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => structuredReview('pass', 'review finished'),
      },
    })
    const reviewTask = createTask(fixture, { name: 'review-P9-MISSING', requiredRole: 'reviewer', status: 'active' })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('missing original task "P9-MISSING"')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain(reviewTask.name)
  })

  it('fails the completed review loudly when the parent run is missing', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => structuredReview('pass', 'review finished'),
      },
    })
    const implTask = createTask(fixture, { name: 'P3', status: 'active' })
    const reviewTask = createTask(fixture, { name: 'review-P3', requiredRole: 'reviewer', status: 'active' })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('no matching lineage run found for "P3"')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain(`original task "${implTask.name}"`)
  })
})
