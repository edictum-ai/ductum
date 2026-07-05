import { execFileSync } from 'node:child_process'

import { afterEach, createFixture, createRun, createTask, describe, expect, fs, gitFixtureTimeoutMs, it, os, path, vi } from './shared.js'

function createZeroDiffWorktree(): { root: string; worktree: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-zero-diff-'))
  const worktree = path.join(root, 'repo')
  fs.mkdirSync(worktree)
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(worktree, 'base.txt'), 'base\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'base')
  git('checkout', '-b', 'feature/zero-diff')
  return { root, worktree }
}

describe('PostCompletionRouter zero-diff guard', () => {
  let root: string | null = null

  afterEach(() => {
    if (root != null) fs.rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('fails normal implementation runs that complete with no diff', async () => {
    const gitFixture = createZeroDiffWorktree()
    root = gitFixture.root
    const onReadyToShip = vi.fn(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveReviewerAgent: () => null,
        rebaseBase: 'main',
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture, { name: 'P1' })
    const run = createRun(fixture, task, { worktreePaths: [gitFixture.worktree] })

    await fixture.router.runImplCompletion(run)

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.ctx.runRepo.get(run.id)).toMatchObject({
      terminalState: 'failed',
      failReason: 'implementation completed with zero diff; normal implementation tasks must change files',
      pendingApproval: false,
    })
    expect(fixture.ctx.evidenceRepo.list(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'worktree.snapshot',
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        }),
      }),
    ]))
  }, gitFixtureTimeoutMs)

  it('fails fix runs that complete with no diff', async () => {
    const gitFixture = createZeroDiffWorktree()
    root = gitFixture.root
    const fixture = createFixture({
      postCompletion: {
        resolveReviewerAgent: () => fixture.builder.id,
        rebaseBase: 'main',
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'active' })
    const implRun = createRun(fixture, implTask, { stage: 'done', worktreePaths: [gitFixture.worktree] })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: [gitFixture.worktree] })

    await fixture.router.runFixCompletion(fixRun)

    expect(fixture.ctx.taskRepo.list(fixture.spec.id).find((task) => task.name === 'review-P1-r2')).toBeUndefined()
    expect(fixture.ctx.runRepo.get(fixRun.id)).toMatchObject({
      terminalState: 'failed',
      failReason: 'fix completed with zero diff; normal fix tasks must change files',
      pendingApproval: false,
    })
    expect(fixture.ctx.evidenceRepo.list(fixRun.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'worktree.snapshot',
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        }),
      }),
    ]))
  }, gitFixtureTimeoutMs)
})
