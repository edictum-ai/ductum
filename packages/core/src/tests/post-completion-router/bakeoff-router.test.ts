import { PostCompletionRouter, createFixture, createRun, createTask, describe, expect, it, vi, structuredBakeoff } from './shared.js'

describe('PostCompletionRouter bakeoff strategy groups', () => {
  it('routes blind review outcomes only to candidates in the review group', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    const staleTask = candidate(fixture, 'candidate-old', 'bon-2')
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    const opusRun = createRun(fixture, opusTask, { stage: 'done' })
    const staleRun = createRun(fixture, staleTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.evidenceRepo.list(codexRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted' }),
    )
    expect(fixture.ctx.evidenceRepo.list(opusRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'rejected' }),
    )
    expect(fixture.ctx.evidenceRepo.list(staleRun.id)).toEqual([])
  })

  it('fails blind review when the review task has no strategy group', async () => {
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => 'PASS: no strategy group available',
      },
    })
    candidate(fixture, 'candidate-codex', 'bon-1')
    candidate(fixture, 'candidate-opus', 'bon-1')
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('strategy group')
  })

  it('normalizes the review strategy group before selecting candidates', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: ' bon-1 ',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.evidenceRepo.list(codexRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted' }),
    )
  })

  it('fails blind review when winner evidence is prose only', async () => {
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => 'PASS: winner: candidate-codex',
      },
    })
    candidate(fixture, 'candidate-codex', 'bon-1')
    candidate(fixture, 'candidate-opus', 'bon-1')
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('ductum-review-result')
  })

  it('fails blind review when the structured winner failed', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const failedTask = candidate(fixture, 'candidate-codex', 'bon-1', 'failed')
    const doneTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, failedTask, { stage: 'done' })
    createRun(fixture, doneTask, { stage: 'done' })
    reviewText = completionText(failedTask.id, [failedTask.id, doneTask.id])
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('winner is not done')
  })

  it('fails blind review when the structured winner score did not pass', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id], {
      [codexTask.id]: false,
    })
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('winner is not eligible')
  })

  it('rejects cost-bearing judge scores to keep review cost-blind', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id], {}, true)
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('ductum-review-result')
  })

  it('rejects judge-supplied operator override fields', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id], {}, false, 'quality-gated-cost-aware', true)
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('ductum-review-result')
  })

  it('fails blind review when the structured verdict policy differs from the spec policy', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id], {}, false, 'cheapest-verified-reviewed')
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('policy mismatch')
  })
})

function candidate(fixture: ReturnType<typeof createFixture>, name: string, group: string, status: 'done' | 'failed' = 'done') {
  return createTask(fixture, {
    name,
    status,
    strategyRole: 'candidate',
    strategyGroup: group,
  })
}

function completionText(
  winnerTaskId: string,
  taskIds: string[],
  passedByTaskId: Record<string, boolean> = {},
  includeCost = false,
  policy = 'quality-gated-cost-aware',
  includeOverride = false,
) {
  return structuredBakeoff(winnerTaskId, taskIds, { passedByTaskId, policy: policy as never, includeCost, includeOverride })
}
