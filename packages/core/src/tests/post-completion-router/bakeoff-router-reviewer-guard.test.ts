import { PostCompletionRouter, createFixture, createRun, createTask, describe, expect, it, vi, structuredBakeoff } from './shared.js'

describe('PostCompletionRouter bakeoff reviewer guard', () => {
  it('fails blind review when typed metadata assigns reviewer as a builder', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: { resolveRunCompletionText: () => reviewText },
    })
    fixture.ctx.specRepo.delete(fixture.spec.id)
    fixture.spec = fixture.ctx.specRepo.create({
      ...fixture.spec,
      strategyConfig: {
        kind: 'best_of_n',
        policy: 'quality-gated-cost-aware',
        strategyGroup: 'bon-1',
        builderAgentIds: [fixture.builder.id],
        reviewerAgentId: fixture.builder.id,
        verify: [],
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const winner = candidate(fixture, 'candidate-codex')
    const loser = candidate(fixture, 'candidate-opus')
    createRun(fixture, winner, { stage: 'done' })
    createRun(fixture, loser, { stage: 'done' })
    reviewText = completionText(winner.id, [winner.id, loser.id])
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
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('reviewer agent must differ')
  })
})

function candidate(fixture: ReturnType<typeof createFixture>, name: string) {
  return createTask(fixture, { name, status: 'done', strategyRole: 'candidate', strategyGroup: 'bon-1' })
}

function completionText(winnerTaskId: string, taskIds: string[]) {
  return [
    'PASS: structured verdict attached.',
    '',
    '```json',
    JSON.stringify({
      kind: 'best-of-n-verdict',
      winnerTaskId,
      scores: taskIds.map((taskId) => ({ taskId, passed: true, notes: 'reviewed' })),
      policy: 'quality-gated-cost-aware',
      reason: 'stronger implementation',
    }),
    '```',
  ].join('\n')
}
