import { PostCompletionRouter, createFixture, createRun, createTask, createTempGitWorktree, describe, expect, fs, it, vi, type RunId } from './shared.js'

describe('PostCompletionRouter implementation review handoff', () => {
  it('marks a completed parent attempt done once review is dispatched without closing the task', async () => {
    const git = createTempGitWorktree()
    try {
      const fixture = createFixture({
        postCompletion: {
          resolveReviewerAgent: () => fixture.builder.id,
        },
      })
      const task = createTask(fixture, { name: 'P1', status: 'active' })
      const run = createRun(fixture, task, { worktreePaths: [git.worktree] })

      await fixture.router.runImplCompletion(run)

      expect(fixture.ctx.runRepo.get(run.id)).toMatchObject({ stage: 'done', terminalState: null })
      expect(fixture.ctx.taskRepo.get(task.id)?.status).toBe('active')
      expect(fixture.ctx.taskRepo.list(fixture.spec.id).some((item) => item.name === 'review-P1')).toBe(true)
    } finally {
      fs.rmSync(git.root, { recursive: true, force: true })
    }
  })
})

describe('PostCompletionRouter bakeoff winner lifecycle', () => {
  it('routes only the selected winner to normal approval', async () => {
    let reviewText = ''
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async (runId) => {
      fixture.ctx.runRepo.updateStage(runId, 'ship')
      fixture.ctx.runRepo.updateWorkflowState(runId, { pendingApproval: true })
    })
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => reviewText,
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG: vi.fn() }))
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    const opusRun = createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const { reviewTask, reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(codexRun.id)
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(codexRun.id)).toMatchObject({ stage: 'ship', pendingApproval: true })
    expect(fixture.ctx.runRepo.get(opusRun.id)).toMatchObject({ stage: 'done', pendingApproval: false })
  })

  it('fails blind review when the selected winner run has not completed', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    createRun(fixture, codexTask, { stage: 'implement' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const { reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('winner run is not done')
  })

  it('rolls back the reopened winner when approval routing fails before ship', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        onReadyToShip: vi.fn(async () => {
          throw new Error('ship gate unavailable')
        }) as never,
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const { reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(codexRun.id)).toMatchObject({ stage: 'done', pendingApproval: false })
    expect(fixture.ctx.evidenceRepo.list(codexRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-ready-to-ship-failed' }),
    )
    expect(fixture.ctx.evidenceRepo.list(codexRun.id).map((item) => item.payload)).not.toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted' }),
    )
  })

  it('finishes outcome recording when retry sees the winner already awaiting approval', async () => {
    let reviewText = ''
    const onReadyToShip = vi.fn(async () => {
      throw new Error('should not be called')
    })
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = candidate(fixture, 'candidate-codex', 'bon-1')
    const opusTask = candidate(fixture, 'candidate-opus', 'bon-1')
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    const opusRun = createRun(fixture, opusTask, { stage: 'done' })
    fixture.ctx.runRepo.updateStage(codexRun.id, 'ship')
    fixture.ctx.runRepo.updateWorkflowState(codexRun.id, { pendingApproval: true })
    fixture.ctx.evidenceRepo.create({
      id: 'evidence-reopen' as never,
      runId: codexRun.id,
      type: 'custom',
      payload: { kind: 'bakeoff-winner-reopened-for-approval' },
    })
    reviewText = completionText(codexTask.id, [codexTask.id, opusTask.id])
    const { reviewTask, reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(codexRun.id)).toMatchObject({ stage: 'ship', pendingApproval: true })
    expect(fixture.ctx.evidenceRepo.list(codexRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted' }),
    )
    expect(fixture.ctx.evidenceRepo.list(opusRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'rejected' }),
    )
  })

  it('selects the cheapest passed candidate under cheapest policy', async () => {
    let reviewText = ''
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async (runId) => {
      fixture.ctx.runRepo.updateStage(runId, 'ship')
      fixture.ctx.runRepo.updateWorkflowState(runId, { pendingApproval: true })
    })
    const fixture = createFixture({
      bakeoff: true,
      bakeoffPolicy: 'cheapest-verified-reviewed',
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => reviewText,
      },
    })
    const expensiveTask = candidate(fixture, 'candidate-expensive', 'bon-1')
    const cheapTask = candidate(fixture, 'candidate-cheap', 'bon-1')
    const expensiveRun = createRun(fixture, expensiveTask, { stage: 'done' })
    const cheapRun = createRun(fixture, cheapTask, { stage: 'done' })
    fixture.ctx.runRepo.setTokens(expensiveRun.id, 1000, 1000, 10)
    fixture.ctx.runRepo.setTokens(cheapRun.id, 100, 100, 1)
    reviewText = completionText(
      expensiveTask.id,
      [expensiveTask.id, cheapTask.id],
      'cheapest-verified-reviewed',
    )
    const { reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(cheapRun.id)
    expect(fixture.ctx.evidenceRepo.list(cheapRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'accepted', policySelected: true }),
    )
    expect(fixture.ctx.evidenceRepo.list(expensiveRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({ kind: 'bakeoff-candidate-outcome', outcome: 'rejected' }),
    )
  })

  it('fails cheapest policy when a passed candidate has zero unmeasured cost', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      bakeoffPolicy: 'cheapest-verified-reviewed',
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const unknownCostTask = candidate(fixture, 'candidate-unknown-cost', 'bon-1')
    const cheapTask = candidate(fixture, 'candidate-cheap', 'bon-1')
    const unknownCostRun = createRun(fixture, unknownCostTask, { stage: 'done' })
    const cheapRun = createRun(fixture, cheapTask, { stage: 'done' })
    fixture.ctx.runRepo.setTokens(unknownCostRun.id, 1000, 1000, 0)
    fixture.ctx.runRepo.setTokens(cheapRun.id, 100, 100, 1)
    reviewText = completionText(
      cheapTask.id,
      [unknownCostTask.id, cheapTask.id],
      'cheapest-verified-reviewed',
    )
    const { reviewRun } = blindReview(fixture)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('known recorded cost')
  })
})

function candidate(fixture: ReturnType<typeof createFixture>, name: string, group: string) {
  return createTask(fixture, {
    name,
    status: 'done',
    strategyRole: 'candidate',
    strategyGroup: group,
  })
}

function blindReview(fixture: ReturnType<typeof createFixture>) {
  const reviewTask = createTask(fixture, {
    name: 'blind-review',
    status: 'active',
    requiredRole: 'reviewer',
    strategyRole: 'blind_review',
    strategyGroup: 'bon-1',
  })
  return { reviewTask, reviewRun: createRun(fixture, reviewTask) }
}

function completionText(winnerTaskId: string, taskIds: string[], policy = 'quality-gated-cost-aware') {
  return [
    'PASS: structured verdict attached.',
    '',
    '```json',
    JSON.stringify({
      kind: 'best-of-n-verdict',
      winnerTaskId,
      scores: taskIds.map((taskId) => ({ taskId, passed: true, notes: 'reviewed' })),
      policy,
      reason: 'stronger implementation',
    }),
    '```',
  ].join('\n')
}
