import { PostCompletionRouter, createFixture, createRun, createTask, describe, expect, it, vi, type EvidenceRepo, type RunId, structuredReview, structuredBakeoff } from './shared.js'

describe('PostCompletionRouter review verdict discipline', () => {
  it('retries a malformed review once without creating an implementation fix', async () => {
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const evaluateTaskDAG = vi.fn()
    const fixture = createFixture({
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => 'Looks good, no issues.',
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG }))
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: implRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).not.toHaveBeenCalled()
    const fixTask = fixture.ctx.taskRepo.list(fixture.spec.id).find((task) => task.name === 'fix-P1-r1')
    expect(fixTask).toBeUndefined()
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('ready')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.retryCount).toBe(1)
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.prompt).toContain('Previous Malformed Review Completion')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.prompt).toContain('"kind": "ductum-review-result"')
    expect(fixture.ctx.runRepo.get(implRun.id)?.stage).toBe('implement')
    expect(evaluateTaskDAG).toHaveBeenCalledWith(fixture.spec.id)
  })

  it('fails a second malformed review with operator-facing recovery guidance', async () => {
    // Decision 060 + 108: the operator must be able to look at the
    // failed review and see (1) why it was rejected and (2) exactly
    // how to retry without digging through evidence rows.
    const onReviewResult = vi.fn(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        onReviewResult: onReviewResult as never,
        resolveRunCompletionText: () => 'Overall I think this is mostly fine.',
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    fixture.ctx.taskRepo.updateRetry(reviewTask.id, 1, null)
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: implRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    const failedReview = fixture.ctx.runRepo.get(reviewRun.id)
    expect(failedReview?.terminalState).toBe('failed')
    expect(failedReview?.failReason).toBeTruthy()
    // The verdict-format violation is preserved verbatim from the parser.
    expect(failedReview?.failReason).toContain('Malformed reviewer completion')
    // Operator gets a copy-pasteable retry command for THIS specific run.
    expect(failedReview?.failReason).toContain('Recovery:')
    expect(failedReview?.failReason).toContain(`retry ${reviewRun.id}`)
    // And a fallback path naming the review task by name.
    expect(failedReview?.failReason).toContain(reviewTask.name)
    // And the instruction to the reviewer for the rerun.
    expect(failedReview?.failReason).toContain('"kind": "ductum-review-result"')
    expect(failedReview?.failReason).not.toContain('terminal line')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('failed')
    // The malformed review is reported as such to onReviewResult so
    // evidence ledgers stay truthful (Decision 108).
    expect(onReviewResult).toHaveBeenCalledWith(
      reviewRun.id,
      expect.objectContaining({ malformed: true, verdict: 'fail', passed: false }),
    )
  })

  it('still routes a clean PASS review to ship even after the verdict format tightened', async () => {
    // Regression guard: the existing PASS routing must keep working
    // with the strict terminal-line parser.
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => structuredReview('pass', 'ready to ship', ['I reviewed every hunk.', 'Verify is green.']),
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: implRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(implRun.id)
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
  })

  it('marks bakeoff candidate artifacts done without requesting merge approval', async () => {
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const evaluateTaskDAG = vi.fn()
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        onReadyToShip: onReadyToShip as never,
        resolveRunCompletionText: () => structuredReview('pass', 'candidate artifact is ready to compare'),
      },
    })
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG }))
    const candidateTask = createTask(fixture, {
      name: 'candidate-codex',
      status: 'active',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const candidateRun = createRun(fixture, candidateTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-candidate-codex', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: candidateRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.ctx.runRepo.get(candidateRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(candidateTask.id)?.status).toBe('done')
    expect(fixture.ctx.evidenceRepo.list(candidateRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({
        kind: 'bakeoff-candidate-outcome',
        outcome: 'fixed',
        source: 'post-completion-router',
        reviewRunId: reviewRun.id,
        reviewTaskId: reviewTask.id,
      }),
    )
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(evaluateTaskDAG).toHaveBeenCalledWith(fixture.spec.id)
  })

  it('rolls back bakeoff candidate state when outcome evidence cannot be written', async () => {
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => structuredReview('pass', 'candidate artifact is ready to compare'),
      },
    })
    const failingEvidenceRepo: EvidenceRepo = {
      list: (runId) => fixture.ctx.evidenceRepo.list(runId),
      create: (entry) => {
        if ((entry.payload as { kind?: string }).kind === 'bakeoff-candidate-outcome') {
          throw new Error('evidence write failed')
        }
        return fixture.ctx.evidenceRepo.create(entry)
      },
    }
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evidenceRepo: failingEvidenceRepo }))
    const candidateTask = createTask(fixture, {
      name: 'candidate-codex',
      status: 'active',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const candidateRun = createRun(fixture, candidateTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-candidate-codex', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: candidateRun.id })

    await expect(fixture.router.runReviewCompletion(reviewRun)).rejects.toThrow('evidence write failed')

    expect(fixture.ctx.runRepo.get(candidateRun.id)?.stage).toBe('implement')
    expect(fixture.ctx.taskRepo.get(candidateTask.id)?.status).toBe('active')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('implement')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('ready')
    expect(fixture.ctx.evidenceRepo.list(candidateRun.id)).toEqual([])
  })

  it('records accepted and rejected candidate outcomes from a bakeoff blind review', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const evaluateTaskDAG = vi.fn()
    fixture.router = new PostCompletionRouter(fixture.buildContext({ evaluateTaskDAG }))
    const codexTask = createTask(fixture, {
      name: 'candidate-codex',
      status: 'done',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const opusTask = createTask(fixture, {
      name: 'candidate-opus',
      status: 'done',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const codexRun = createRun(fixture, codexTask, { stage: 'done' })
    const opusRun = createRun(fixture, opusTask, { stage: 'done' })
    reviewText = bakeoffCompletion(codexTask.id, [codexTask.id, opusTask.id])
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
      expect.objectContaining({
        kind: 'bakeoff-candidate-outcome',
        outcome: 'accepted',
        source: 'blind-review-router',
        blindReviewRunId: reviewRun.id,
        winnerTaskName: 'candidate-codex',
        winnerTaskId: codexTask.id,
      }),
    )
    expect(fixture.ctx.evidenceRepo.list(opusRun.id).map((item) => item.payload)).toContainEqual(
      expect.objectContaining({
        kind: 'bakeoff-candidate-outcome',
        outcome: 'rejected',
        source: 'blind-review-router',
        blindReviewRunId: reviewRun.id,
        winnerTaskName: 'candidate-codex',
      }),
    )
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(evaluateTaskDAG).toHaveBeenCalledWith(fixture.spec.id)
  })

  it('fails a second malformed bakeoff blind review loudly when the winner is ambiguous', async () => {
    let reviewText = ''
    const fixture = createFixture({
      bakeoff: true,
      postCompletion: {
        resolveRunCompletionText: () => reviewText,
      },
    })
    const codexTask = createTask(fixture, {
      name: 'candidate-codex',
      status: 'done',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const opusTask = createTask(fixture, {
      name: 'candidate-opus',
      status: 'done',
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    createRun(fixture, codexTask, { stage: 'done' })
    createRun(fixture, opusTask, { stage: 'done' })
    reviewText = [
      'PASS: conflicting structured verdicts.',
      '',
      verdictBlock(codexTask.id, [codexTask.id, opusTask.id]),
      verdictBlock(opusTask.id, [codexTask.id, opusTask.id]),
    ].join('\n')
    const reviewTask = createTask(fixture, {
      name: 'blind-review',
      status: 'active',
      requiredRole: 'reviewer',
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    fixture.ctx.taskRepo.updateRetry(reviewTask.id, 1, null)
    const reviewRun = createRun(fixture, reviewTask)

    await fixture.router.runBlindReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(reviewRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.failReason).toContain('multiple structured ductum-review-result')
  })
})

function bakeoffCompletion(winnerTaskId: string, taskIds: string[]): string {
  return structuredBakeoff(winnerTaskId, taskIds)
}

function verdictBlock(winnerTaskId: string, taskIds: string[]): string {
  return structuredBakeoff(winnerTaskId, taskIds)
}
