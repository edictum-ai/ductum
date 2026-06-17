import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { WorktreeManager, WorktreeSetupError } from '../worktree.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('WorktreeManager', () => {
  it('throws when a setup command fails instead of returning a broken worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-worktree-setup-'))
    cleanup.push(root)
    const repo = join(root, 'repo')
    execFileSync('git', ['init', repo], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Ductum Test'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'ductum@example.test'], { stdio: 'pipe' })
    writeFileSync(join(repo, 'README.md'), 'test\n')
    execFileSync('git', ['-C', repo, 'add', 'README.md'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'commit', '--no-verify', '-m', 'init'], { stdio: 'pipe' })

    const manager = new WorktreeManager({
      basePath: join(root, 'worktrees'),
    })

    await expect(
      manager.create(repo, 'setup-fails', 'run123456', 'ductum', ['false']),
    ).rejects.toThrow(WorktreeSetupError)
  }, 20_000)

  it('restores a missing git worktree from a recorded branch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-worktree-restore-'))
    cleanup.push(root)
    const repo = join(root, 'repo')
    const worktree = join(root, 'worktrees', 'project', 'task-run', 'repo')
    execFileSync('git', ['init', repo], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Ductum Test'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'ductum@example.test'], { stdio: 'pipe' })
    writeFileSync(join(repo, 'README.md'), 'base\n')
    execFileSync('git', ['-C', repo, 'add', 'README.md'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'commit', '--no-verify', '-m', 'init'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'switch', '-c', 'ductum/p1-run'], { stdio: 'pipe' })
    writeFileSync(join(repo, 'candidate.txt'), 'candidate\n')
    execFileSync('git', ['-C', repo, 'add', 'candidate.txt'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'commit', '--no-verify', '-m', 'candidate'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'switch', '-'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repo, 'worktree', 'add', worktree, 'ductum/p1-run'], { stdio: 'pipe' })
    rmSync(worktree, { recursive: true, force: true })

    const manager = new WorktreeManager({ basePath: join(root, 'unused') })
    await expect(manager.restore(repo, worktree, 'ductum/p1-run', ['test -f candidate.txt'])).resolves.toBe(worktree)

    expect(existsSync(worktree)).toBe(true)
    expect(readFileSync(join(worktree, 'candidate.txt'), 'utf8')).toBe('candidate\n')
  }, 20_000)
})
