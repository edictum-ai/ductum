import { afterEach, createFixture, createRun, createTask, createTempGitWorktree, describe, expect, fs, gitFixtureTimeoutMs, it, os, path, vi, type RunId } from './shared.js'

describe('PostCompletionRouter verification failure routing', () => {
  it('dispatches a fix task instead of failing the root implementation run', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-verify-fix-'))
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    try {
      const fixture = createFixture({
        postCompletion: {
          resolveVerifyCommands: () => ['false'],
          resolveReviewerAgent: () => null,
          onReadyToShip: onReadyToShip as never,
        },
      })
      const implTask = createTask(fixture, { name: 'P1' })
      const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })

      await fixture.router.runImplCompletion(implRun)

      expect(onReadyToShip).not.toHaveBeenCalled()
      expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBeNull()
      const fixTask = fixture.ctx.taskRepo.list(fixture.spec.id).find((task) => task.name === 'fix-P1-r1')
      expect(fixTask).toBeDefined()
      expect(fixTask?.status).toBe('ready')
      expect(fixTask?.assignedAgentId).toBe(implRun.agentId)
      expect(fixTask?.prompt).toContain('Verification Fix Task')
      expect(fixTask?.prompt).toContain('false')
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })

  it('routes failed fix verification into the next fix round', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-verify-fix-'))
    try {
      const fixture = createFixture({
        postCompletion: {
          resolveVerifyCommands: () => ['false'],
          resolveReviewerAgent: () => null,
        },
      })
      const implTask = createTask(fixture, { name: 'P1' })
      const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })
      const fixTask = createTask(fixture, { name: 'fix-P1-r1' })
      const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: [worktree] })

      await fixture.router.runFixCompletion(fixRun)

      expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBeNull()
      const nextFix = fixture.ctx.taskRepo.list(fixture.spec.id).find((task) => task.name === 'fix-P1-r2')
      expect(nextFix).toBeDefined()
      expect(nextFix?.status).toBe('ready')
      expect(nextFix?.prompt).toContain('Verification Fix Task')
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true })
    }
  })
})

describe('PostCompletionRouter git artifact sync', () => {
  let root: string | null = null

  afterEach(() => {
    if (root != null) fs.rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('records the worktree branch and commit before a no-review ready-to-ship transition', async () => {
    const gitFixture = createTempGitWorktree()
    root = gitFixture.root
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveReviewerAgent: () => null,
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'P1' })
    const run = createRun(fixture, task, { worktreePaths: [gitFixture.worktree] })

    await fixture.router.runImplCompletion(run)

    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
    const updated = fixture.ctx.runRepo.get(run.id)
    expect(updated?.branch).toBe(gitFixture.branch)
    expect(updated?.commitSha).toBe(gitFixture.commitSha)
  }, gitFixtureTimeoutMs)

  it('routes an impl task whose name starts with review- through runImplCompletion (P18 regression)', async () => {
    // P18 regression: an impl task imported from a spec that happens to be
    // named `review-verdict-strictness` (requiredRole=null) was previously
    // classified by name parsing as a review task. handleSessionEnd would
    // then call runReviewCompletion, fail to find a parent task named
    // `verdict-strictness`, and silently return — leaving the run stuck
    // in `implement` with verified work. classifyTask now uses
    // requiredRole as the authoritative signal so this reaches
    // onReadyToShip via runImplCompletion.
    const gitFixture = createTempGitWorktree()
    root = gitFixture.root
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveReviewerAgent: () => null,
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'review-verdict-strictness', requiredRole: null })
    const run = createRun(fixture, task, { worktreePaths: [gitFixture.worktree] })

    await fixture.router.runImplCompletion(run)

    expect(onReadyToShip).toHaveBeenCalledWith(run.id)
    const updated = fixture.ctx.runRepo.get(run.id)
    expect(updated?.branch).toBe(gitFixture.branch)
    expect(updated?.commitSha).toBe(gitFixture.commitSha)
  }, gitFixtureTimeoutMs)

  it('copies reviewed fix worktree artifacts onto the root run on PASS', async () => {
    const gitFixture = createTempGitWorktree()
    root = gitFixture.root
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => 'PASS: fix verified',
        onReadyToShip: onReadyToShip as never,
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask)
    const fix1Task = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const fix1Run = createRun(fixture, fix1Task, { parentRunId: implRun.id })
    const fixTask = createTask(fixture, { name: 'fix-P1-r2', status: 'active' })
    const fixRun = createRun(fixture, fixTask, {
      parentRunId: fix1Run.id,
      worktreePaths: [gitFixture.worktree],
    })
    const reviewTask = createTask(fixture, { name: 'review-P1-r3', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: fixRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).toHaveBeenCalledWith(implRun.id)
    expect(fixture.ctx.runRepo.get(fix1Run.id)?.stage).toBe('done')
    expect(fixture.ctx.runRepo.get(fixRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(fix1Task.id)?.status).toBe('done')
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(fixRun.id)?.branch).toBe(gitFixture.branch)
    expect(fixture.ctx.runRepo.get(fixRun.id)?.commitSha).toBe(gitFixture.commitSha)
    expect(fixture.ctx.runRepo.get(implRun.id)?.branch).toBe(gitFixture.branch)
    expect(fixture.ctx.runRepo.get(implRun.id)?.commitSha).toBe(gitFixture.commitSha)
  }, gitFixtureTimeoutMs)

  it('reopens a failed root before advancing a reviewed fix to approval', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => 'PASS: fix verified after reconcile',
        onReadyToShip: vi.fn<(_runId: RunId) => Promise<void>>(async (runId) => {
          const reopened = fixture.ctx.runRepo.get(runId)!
          expect(reopened.terminalState).toBeNull()
          expect(reopened.failReason).toBeNull()
          expect(reopened.recoverable).toBe(true)
          fixture.ctx.runRepo.updateStage(runId, 'ship')
          fixture.ctx.runRepo.updateWorkflowState(runId, { pendingApproval: true })
        }) as never,
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const implRun = createRun(fixture, implTask)
    fixture.ctx.runRepo.updateTerminalState(implRun.id, 'failed')
    fixture.ctx.runRepo.updateFailure(implRun.id, 'orphaned by reconcile (no live session)', false)
    const fixTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: fixRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    const rootAfter = fixture.ctx.runRepo.get(implRun.id)
    expect(rootAfter).toMatchObject({
      stage: 'ship',
      terminalState: null,
      pendingApproval: true,
      failReason: null,
      recoverable: true,
    })
    expect(fixture.ctx.taskRepo.get(implTask.id)?.status).toBe('active')
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('done')
    const reopenEvidence = fixture.ctx.evidenceRepo.list(implRun.id).find((e) => {
      return (e.payload as { kind?: string }).kind === 'post-completion-root-reopened'
    })
    expect(reopenEvidence?.payload).toMatchObject({
      source: 'post-completion-router',
      reviewRunId: reviewRun.id,
      before: {
        terminalState: 'failed',
        failReason: 'orphaned by reconcile (no live session)',
        recoverable: false,
      },
      after: {
        terminalState: null,
        failReason: null,
        recoverable: true,
      },
    })
  })
})
