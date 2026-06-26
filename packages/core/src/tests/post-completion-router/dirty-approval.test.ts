import { execFileSync } from 'node:child_process'

import { vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  autoCommitWorktree: vi.fn(),
}))

vi.mock('../../auto-commit.js', () => ({
  autoCommitWorktree: mocks.autoCommitWorktree,
}))

import { createFixture, createRun, createTask, describe, expect, fs, gitFixtureTimeoutMs, it, os, path } from './shared.js'

function createDirtyTrackedWorktree(): { root: string; worktree: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-dirty-approval-'))
  const worktree = path.join(root, 'repo')
  fs.mkdirSync(worktree)
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'base\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'base')
  git('checkout', '-b', 'feature/dirty')
  fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'changed but uncommitted\n')
  fs.mkdirSync(path.join(worktree, '.pnpm-store'))
  fs.writeFileSync(path.join(worktree, '.pnpm-store', 'noise.txt'), 'cache noise\n')
  return { root, worktree }
}

describe('PostCompletionRouter dirty approval guard', () => {
  it('fails closed when tracked source changes remain after auto-commit fails', async () => {
    const fixtureRoot = createDirtyTrackedWorktree()
    try {
      mocks.autoCommitWorktree.mockResolvedValueOnce({
        dirty: true,
        committed: false,
        error: 'git add -A failed: generated cache refused staging',
      })
      const fixture = createFixture()
      const task = createTask(fixture, { name: 'P1-DIRTY-APPROVAL' })
      const run = createRun(fixture, task, { worktreePaths: [fixtureRoot.worktree] })

      await fixture.router.runImplCompletion(run)

      const updated = fixture.ctx.runRepo.get(run.id)
      expect(updated).toMatchObject({
        terminalState: 'failed',
        pendingApproval: false,
      })
      expect(updated?.failReason).toContain('auto-commit failed before approval snapshot')
      expect(updated?.failReason).toContain('M tracked.txt')
      expect(updated?.failReason).not.toContain('.pnpm-store')
      expect(fixture.ctx.evidenceRepo.list(run.id)).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'worktree.snapshot' }),
        }),
      ]))
    } finally {
      fs.rmSync(fixtureRoot.root, { recursive: true, force: true })
    }
  }, gitFixtureTimeoutMs)
})
