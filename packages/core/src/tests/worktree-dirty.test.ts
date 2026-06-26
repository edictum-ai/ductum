import { execFileSync } from 'node:child_process'

import { describe, expect, fs, it, os, path } from './post-completion-router/shared.js'
import { readTrackedWorktreeChanges } from '../worktree-dirty.js'

function createDirtyTrackedFixture(): { root: string; worktree: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-tracked-dirty-'))
  const worktree = path.join(root, 'repo')
  fs.mkdirSync(worktree)
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'base\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'base')
  fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'changed\n')
  fs.mkdirSync(path.join(worktree, '.pnpm-store'))
  fs.writeFileSync(path.join(worktree, '.pnpm-store', 'noise.txt'), 'cache\n')
  return { root, worktree }
}

describe('readTrackedWorktreeChanges', () => {
  it('reports tracked changes without treating generated untracked cache noise as source dirtiness', async () => {
    const fixture = createDirtyTrackedFixture()
    try {
      const result = await readTrackedWorktreeChanges(fixture.worktree)

      expect(result.error).toBeUndefined()
      expect(result.files).toEqual(['M tracked.txt'])
      expect(result.files.join('\n')).not.toContain('.pnpm-store')
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
