import { PostCompletionRouter, afterEach, beforeEach, createFixture, createRun, createTask, describe, execFileSync, expect, fs, gitFixtureTimeoutMs, it, os, path, structuredReview } from './shared.js'
import { validateEvidencePayload } from '../../evidence-kinds.js'

describe('PostCompletionRouter failed lineage cleanup', () => {
  it('closes queued descendant fix/review tasks that do not have runs yet', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => structuredReview('fail', 'still broken after the latest fix'),
        maxFixIterations: 1,
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'active' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })
    const queuedFix = createTask(fixture, { name: 'fix-P1-r2', status: 'ready' })
    const queuedReview = createTask(fixture, { name: 'review-P1-r2', status: 'ready', requiredRole: 'reviewer' })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: fixRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(implTask.id)?.status).toBe('failed')
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('failed')
    expect(fixture.ctx.taskRepo.get(queuedFix.id)?.status).toBe('failed')
    expect(fixture.ctx.taskRepo.get(queuedReview.id)?.status).toBe('failed')
    expect(fixture.ctx.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.ctx.taskRepo.get(reviewTask.id)?.status).toBe('done')
  })

  it('skips descendant runs that still have a live session', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveRunCompletionText: () => structuredReview('fail', 'still broken after the latest fix'),
        maxFixIterations: 1,
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const staleFixTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const staleFixRun = createRun(fixture, staleFixTask, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })
    const liveFixTask = createTask(fixture, { name: 'fix-P1-r99', status: 'active' })
    const liveFixRun = createRun(fixture, liveFixTask, { parentRunId: staleFixRun.id, worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: staleFixRun.id })

    fixture.router = new PostCompletionRouter(
      fixture.buildContext({
        hasLiveSession: (runId) => runId === liveFixRun.id,
      }),
    )

    await fixture.router.runReviewCompletion(reviewRun)

    expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.runRepo.get(staleFixRun.id)?.terminalState).toBe('failed')
    expect(fixture.ctx.taskRepo.get(staleFixTask.id)?.status).toBe('failed')
    expect(fixture.ctx.runRepo.get(liveFixRun.id)?.terminalState).toBeNull()
    expect(fixture.ctx.taskRepo.get(liveFixTask.id)?.status).toBe('active')
  })
})

describe('PostCompletionRouter rebase-before-verify', () => {
  let upstream: string
  let worktree: string

  beforeEach(() => {
    // Set up a real temp git repo with a feature branch that diverged
    // from main. The router's rebase step shells out to git so we need
    // a real worktree, not mocks.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-rebase-'))
    upstream = path.join(root, 'upstream')
    fs.mkdirSync(upstream)
    const git = (...args: string[]) => execFileSync('git', ['-C', upstream, ...args], { stdio: 'pipe' })
    git('init', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    fs.writeFileSync(path.join(upstream, 'shared.txt'), 'base\n')
    git('add', '.')
    git('commit', '--no-verify', '-m', 'base')
    git('checkout', '-b', 'feature/x')
    fs.writeFileSync(path.join(upstream, 'feature.txt'), 'feature work\n')
    git('add', '.')
    git('commit', '--no-verify', '-m', 'feature commit')
    // Now switch back to main and add a non-conflicting commit so the
    // feature branch is behind main.
    git('checkout', 'main')
    fs.writeFileSync(path.join(upstream, 'other.txt'), 'main moved on\n')
    git('add', '.')
    git('commit', '--no-verify', '-m', 'parallel commit on main')
    git('checkout', 'feature/x')
    worktree = upstream
  }, gitFixtureTimeoutMs)

  afterEach(() => {
    if (upstream != null) fs.rmSync(path.dirname(upstream), { recursive: true, force: true })
  })

  it('rebases the worktree onto base before verify when needed (no conflict)', async () => {
    const fixture = createFixture({
      postCompletion: {
        rebaseBase: 'main',
        // No verify and no reviewer so the test stops after rebase.
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })

    await fixture.router.runImplCompletion(implRun)

    // After rebase, the feature branch should contain the parallel
    // commit from main.
    const log = execFileSync('git', ['-C', worktree, 'log', '--oneline'], { encoding: 'utf-8' })
    expect(log).toContain('parallel commit on main')
    expect(log).toContain('feature commit')
    // No fix-rebase task should have been dispatched.
    const tasks = fixture.ctx.taskRepo.list(fixture.spec.id)
    expect(tasks.find((t) => t.name.startsWith('fix-P1-'))).toBeUndefined()
    const snapshot = fixture.ctx.evidenceRepo
      .list(implRun.id)
      .find((item) => item.payload.kind === 'worktree.snapshot')
    expect(snapshot).toBeDefined()
    expect(validateEvidencePayload(snapshot!.payload)).toBe(true)
    expect(snapshot!.payload).toMatchObject({
      kind: 'worktree.snapshot',
      branch: 'feature/x',
      diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
      verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
    })
  }, gitFixtureTimeoutMs)

  it('dispatches a fix-rebase task when the rebase hits a conflict', async () => {
    // Create a conflicting change on main: edit the same file the
    // feature branch already modified.
    const git = (...args: string[]) => execFileSync('git', ['-C', upstream, ...args], { stdio: 'pipe' })
    git('checkout', 'main')
    fs.writeFileSync(path.join(upstream, 'feature.txt'), 'main wrote here first\n')
    git('add', '.')
    git('commit', '--no-verify', '-m', 'conflict on main')
    git('checkout', 'feature/x')

    const fixture = createFixture({
      postCompletion: {
        rebaseBase: 'main',
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })

    await fixture.router.runImplCompletion(implRun)

    // Worktree should be clean (rebase aborted, not stuck mid-rebase).
    const status = execFileSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(status.trim()).toBe('')

    // A fix-rebase task should now exist.
    const tasks = fixture.ctx.taskRepo.list(fixture.spec.id)
    const fixTask = tasks.find((t) => t.name.startsWith('fix-P1-r'))
    expect(fixTask).toBeDefined()
    expect(fixTask?.prompt).toContain('Rebase Conflict')
    expect(fixTask?.prompt).toContain('main')
  }, gitFixtureTimeoutMs)

  it('auto-commits a dirty worktree before rebasing onto base', async () => {
    // Drop an untracked file in the feature worktree to simulate the
    // Codex SDK harness leaving files behind. Without the auto-commit
    // gate, the rebase would either pull-in the dirty file or refuse.
    fs.writeFileSync(path.join(worktree, 'leftover.txt'), 'agent forgot to commit me\n')
    const dirtyBefore = execFileSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(dirtyBefore.trim()).not.toBe('')

    const fixture = createFixture({
      postCompletion: {
        rebaseBase: 'main',
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const implTask = createTask(fixture, { name: 'P1-DIRTY' })
    const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })

    await fixture.router.runImplCompletion(implRun)

    // Worktree must be clean now AND the rebase must have happened.
    const status = execFileSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(status.trim()).toBe('')

    const log = execFileSync('git', ['-C', worktree, 'log', '--oneline'], { encoding: 'utf-8' })
    expect(log).toContain('parallel commit on main') // proof of rebase
    expect(log).toContain('chore(auto-commit): finalize P1-DIRTY') // proof of auto-commit

    // The auto-commit should contain the leftover file.
    const filesInAutoCommit = execFileSync(
      'git',
      ['-C', worktree, 'log', '-1', '--format=', '--name-only', "--grep=auto-commit"],
      { encoding: 'utf-8' },
    )
    expect(filesInAutoCommit).toContain('leftover.txt')
  }, gitFixtureTimeoutMs)

  it('skips rebase entirely when rebaseBase is unset', async () => {
    const fixture = createFixture({
      postCompletion: {
        // rebaseBase NOT set
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const implTask = createTask(fixture, { name: 'P1' })
    const implRun = createRun(fixture, implTask, { worktreePaths: [worktree] })

    await fixture.router.runImplCompletion(implRun)

    // Feature branch state unchanged — no rebase happened.
    const log = execFileSync('git', ['-C', worktree, 'log', '--oneline', 'feature/x'], { encoding: 'utf-8' })
    expect(log).not.toContain('parallel commit on main')
  }, gitFixtureTimeoutMs)
})
