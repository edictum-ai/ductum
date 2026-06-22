import { PostCompletionRouter, createFixture, createId, createRun, createTask, describe, expect, it, vi, structuredBakeoff } from './shared.js'

describe('PostCompletionRouter bakeoff JSON-only verdicts', () => {
  it('routes a structured verdict without a PASS/WARN/FAIL review footer', async () => {
    let completionText = ''
    const onReviewResult = vi.fn()
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => completionText,
        onReviewResult,
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const winnerTask = candidate(fixture, 'candidate-gpt55')
    const loserTask = candidate(fixture, 'candidate-sonnet46')
    const winnerRun = createRun(fixture, winnerTask, { stage: 'done' })
    const loserRun = createRun(fixture, loserTask, { stage: 'done' })
    completionText = jsonOnlyVerdict(winnerTask.id, [winnerTask.id, loserTask.id])
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(onReviewResult).toHaveBeenCalledWith(reviewRun.id, expect.objectContaining({ verdict: 'pass', passed: true }))
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.evidenceRepo.list(reviewRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'best-of-n-verdict', winnerTaskId: winnerTask.id }),
    )
    expect(fixture.ctx.evidenceRepo.list(winnerRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted' }),
    )
    expect(fixture.ctx.evidenceRepo.list(loserRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'rejected' }),
    )
  })

  it('routes a code-fenced structured verdict without treating it as duplicate JSON', async () => {
    let completionText = ''
    const onReviewResult = vi.fn()
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => completionText,
        onReviewResult,
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const winnerTask = candidate(fixture, 'candidate-gpt55')
    const loserTask = candidate(fixture, 'candidate-sonnet46')
    createRun(fixture, winnerTask, { stage: 'done' })
    createRun(fixture, loserTask, { stage: 'done' })
    completionText = ['```json', jsonOnlyVerdict(winnerTask.id, [winnerTask.id, loserTask.id]), '```'].join('\n')
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(onReviewResult).toHaveBeenCalledWith(reviewRun.id, expect.objectContaining({ verdict: 'pass', passed: true }))
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
  })

  it('writes canonical scored verdict evidence when a judge pre-records a partial verdict payload', async () => {
    let completionText = ''
    const fixture = createFixture({ bakeoff: true, postCompletion: { resolveRunCompletionText: () => completionText } })
    const winnerTask = candidate(fixture, 'candidate-gpt55')
    const loserTask = candidate(fixture, 'candidate-sonnet46')
    createRun(fixture, winnerTask, { stage: 'done' })
    createRun(fixture, loserTask, { stage: 'done' })
    completionText = jsonOnlyVerdict(winnerTask.id, [winnerTask.id, loserTask.id])
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)
    fixture.ctx.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId: reviewRun.id,
      type: 'review',
      payload: { kind: 'best-of-n-verdict', winnerTaskId: winnerTask.id, policy: 'quality-gated-cost-aware' },
    })

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.evidenceRepo.list(reviewRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'best-of-n-verdict', scores: expect.any(Array) }),
    )
  })

  it('retries a malformed blind review once when the structured verdict was attached only as evidence', async () => {
    const onReviewResult = vi.fn()
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => 'Blind review complete; structured verdict attached as evidence.',
        onReviewResult,
      },
    })
    const evaluateTaskDAG = vi.fn()
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG }))
    const winnerTask = candidate(fixture, 'candidate-gpt55')
    const loserTask = candidate(fixture, 'candidate-sonnet46')
    createRun(fixture, winnerTask, { stage: 'done' })
    createRun(fixture, loserTask, { stage: 'done' })
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const reviewRun = createRun(fixture, reviewTask)
    fixture.ctx.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId: reviewRun.id,
      type: 'custom',
      payload: JSON.parse(jsonOnlyVerdict(winnerTask.id, [winnerTask.id, loserTask.id])) as Record<string, unknown>,
    })

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('evidence cannot override')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('ready')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.retryCount).toBe(1)
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.prompt).toContain('"kind": "ductum-review-result"')
    expect(onReviewResult).toHaveBeenCalledWith(reviewRun.id, expect.objectContaining({ malformed: true }))
    expect(evaluateTaskDAG).toHaveBeenCalledWith(fixture.spec.id)
  })

  it('fails a second malformed blind review when the structured verdict was attached only as evidence', async () => {
    const fixture = createFixture({ bakeoff: true, postCompletion: { resolveRunCompletionText: () => 'Blind review complete; structured verdict attached as evidence.' } })
    const winnerTask = candidate(fixture, 'candidate-gpt55')
    const loserTask = candidate(fixture, 'candidate-sonnet46')
    const winnerRun = createRun(fixture, winnerTask, { stage: 'done' })
    const loserRun = createRun(fixture, loserTask, { stage: 'done' })
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    fixture.ctx.taskRepo.updateRetry(reviewTask.id, 1, null)
    const reviewRun = createRun(fixture, reviewTask)
    fixture.ctx.evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId: reviewRun.id,
      type: 'custom',
      payload: JSON.parse(jsonOnlyVerdict(winnerTask.id, [winnerTask.id, loserTask.id])) as Record<string, unknown>,
    })

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('evidence cannot override')
  })
})

function candidate(fixture: ReturnType<typeof createFixture>, name: string) {
  return createTask(fixture, {
    name,
    status: 'done',
    strategyRole: 'candidate',
    strategyGroup: 'bon-1',
  })
}

function jsonOnlyVerdict(winnerTaskId: string, taskIds: string[]) {
  return structuredBakeoff(winnerTaskId, taskIds)
}
