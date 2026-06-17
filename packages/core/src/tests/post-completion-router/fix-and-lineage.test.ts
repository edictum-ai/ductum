import { createFixture, createRun, createTask, describe, expect, fs, it, os, path, vi, type SpecId } from './shared.js'

describe('PostCompletionRouter.runFixCompletion iteration cap', () => {
  it('allows a verified final fix at the cap to proceed to review', async () => {
    const fixture = createFixture({
      postCompletion: {
        maxFixIterations: 3,
        resolveReviewerAgent: () => fixture.builder.id,
      },
    })
    // Build a 3-deep fix chain: impl -> fix-r1 -> fix-r2 -> fix-r3
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
    const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })
    const fix2Task = createTask(fixture, { name: 'fix-P1-r2' })
    const fix2 = createRun(fixture, fix2Task, { parentRunId: fix1.id, worktreePaths: ['/tmp/wt'] })
    const fix3Task = createTask(fixture, { name: 'fix-P1-r3' })
    const fix3 = createRun(fixture, fix3Task, { parentRunId: fix2.id, worktreePaths: ['/tmp/wt'] })

    await fixture.router.runFixCompletion(fix3)

    const rootAfter = fixture.ctx.runRepo.get(implRun.id)
    expect(rootAfter?.terminalState).toBeNull()
    expect(rootAfter?.failReason).toBeNull()
    expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1-r4')).toBeDefined()
  })

  it('honors the spec-level maxFixIterations override when creating the final review', async () => {
    // Spec allows only 1 fix; factory default is 3.
    const fixture = createFixture({
      postCompletion: {
        maxFixIterations: 3,
        resolveReviewerAgent: () => fixture.builder.id,
      },
      specMaxFixIterations: 1,
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
    const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })

    await fixture.router.runFixCompletion(fix1)

    const rootAfter = fixture.ctx.runRepo.get(implRun.id)
    expect(rootAfter?.terminalState).toBeNull()
    expect(rootAfter?.failReason).toBeNull()
    expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1-r2')).toBeDefined()
  })

  it('retries verification once on the final allowed fix iteration before review', async () => {
    const verificationResults = vi.fn()
    const fixture = createFixture({
      postCompletion: {
        maxFixIterations: 1,
        resolveReviewerAgent: () => fixture.builder.id,
        resolveVerifyCommands: () => ['test -f verify-ok || (touch verify-ok && false)'],
        onVerificationResult: verificationResults,
      },
      specMaxFixIterations: 1,
    })
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-final-verify-pass-'))
    try {
      const implTask = createTask(fixture, { name: 'P1' })
      const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })
      const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
      const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id, worktreePaths: [worktree] })

      await fixture.router.runFixCompletion(fix1)

      expect(fixture.ctx.runRepo.get(fix1.id)?.verifyRetries).toBe(1)
      expect(verificationResults).toHaveBeenCalledTimes(2)
      expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBeNull()
      expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((t) => t.name === 'review-P1-r2')).toBeDefined()
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })

  it('fails the root after the final allowed fix verification retry also fails', async () => {
    const verificationResults = vi.fn()
    const fixture = createFixture({
      postCompletion: {
        maxFixIterations: 1,
        resolveReviewerAgent: () => fixture.builder.id,
        resolveVerifyCommands: () => ['false'],
        onVerificationResult: verificationResults,
      },
      specMaxFixIterations: 1,
    })
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-final-verify-fail-'))
    try {
      const implTask = createTask(fixture, { name: 'P1' })
      const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })
      const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
      const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id, worktreePaths: [worktree] })

      await fixture.router.runFixCompletion(fix1)

      const rootAfter = fixture.ctx.runRepo.get(implRun.id)
      expect(fixture.ctx.runRepo.get(fix1.id)?.verifyRetries).toBe(1)
      expect(verificationResults).toHaveBeenCalledTimes(2)
      expect(rootAfter?.terminalState).toBe('failed')
      expect(rootAfter?.failReason).toMatch(/max_review_iterations/)
      expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((t) => t.name === 'fix-P1-r2')).toBeUndefined()
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })

  it('closes a late review when max iterations is reached after the root already failed', async () => {
    const fixture = createFixture({
      postCompletion: {
        maxFixIterations: 2,
        resolveRunCompletionText: () => 'FAIL: still broken',
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const implRun = createRun(fixture, implTask, { terminalState: 'failed', worktreePaths: ['/tmp/wt'] })
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1', status: 'failed' })
    const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id, terminalState: 'failed' })
    const fix2Task = createTask(fixture, { name: 'fix-P1-r2', status: 'failed' })
    const fix2 = createRun(fixture, fix2Task, { parentRunId: fix1.id, terminalState: 'failed' })
    const reviewTask = createTask(fixture, { name: 'review-P1-r3', requiredRole: 'reviewer', status: 'active' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: fix2.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
    expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((t) => t.name === 'fix-P1-r3')).toBeUndefined()
  })
})

describe('PostCompletionRouter.lineageAlreadyShipped guard', () => {
  it('skips review routing when the root impl has already shipped', async () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    // Root run already done — represents the case where the user
    // approved a descendant before this review's session ended.
    const implRun = createRun(fixture, implTask, { stage: 'done', worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: implRun.id })

    // resolveRunCompletionText returns FAIL — without the guard this
    // would dispatch a fix task. With the guard, nothing happens.
    fixture.postCompletion.resolveRunCompletionText = () => 'FAIL: stale review'

    await fixture.router.runReviewCompletion(reviewRun)

    // No fix-P1-r1 task should have been created.
    const tasks = fixture.ctx.taskRepo.list(fixture.spec.id)
    expect(tasks.find((t) => t.name === 'fix-P1-r1')).toBeUndefined()
    // Root run stays done, no terminal flip.
    expect(fixture.ctx.runRepo.get(implRun.id)?.stage).toBe('done')
  })

  it('skips fix routing when the lineage root is already done', async () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { stage: 'done', worktreePaths: ['/tmp/wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })

    // No-op even though we'd otherwise re-dispatch a review.
    await fixture.router.runFixCompletion(fixRun)

    const tasks = fixture.ctx.taskRepo.list(fixture.spec.id)
    expect(tasks.find((t) => t.name === 'review-P1-r2')).toBeUndefined()
    expect(fixture.ctx.runRepo.get(implRun.id)?.stage).toBe('done')
  })
})

describe('PostCompletionRouter lineage helpers', () => {
  it('walkParentChain walks newest → oldest and stops at the root', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask)
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
    const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id })
    const fix2Task = createTask(fixture, { name: 'fix-P1-r2' })
    const fix2 = createRun(fixture, fix2Task, { parentRunId: fix1.id })

    const chain = fixture.router.walkParentChain(fix2)
    expect(chain.map((r) => r.id)).toEqual([fix2.id, fix1.id, implRun.id])
    expect(fixture.router.findRootRun(fix2)?.id).toBe(implRun.id)
  })

  it('findMostRecentLineageRun returns the latest run across the impl + fix tasks', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask)
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1' })
    const fix1 = createRun(fixture, fix1Task, { parentRunId: implRun.id })

    const recent = fixture.router.findMostRecentLineageRun(fixture.spec.id as SpecId, 'P1')
    expect(recent?.id).toBe(fix1.id)
  })

  it('resolveDispatchIntent for review reuses the newest fix worktree when timestamps tie', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    createRun(fixture, implTask, { worktreePaths: ['/tmp/impl-wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1' })
    const fixRun = createRun(fixture, fixTask, { worktreePaths: ['/tmp/fix-wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    expect(fixture.router.resolveDispatchIntent(reviewTask)).toEqual({
      parentRunId: fixRun.id,
      reuseWorktreeFromRunId: fixRun.id,
    })
  })

  it('resolveDispatchIntent keeps the newest lineage parent but falls back to an older real worktree', () => {
    const fixture = createFixture()
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/impl-wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: null })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    expect(fixture.router.resolveDispatchIntent(reviewTask)).toEqual({
      parentRunId: fixRun.id,
      reuseWorktreeFromRunId: implRun.id,
    })
  })
})
