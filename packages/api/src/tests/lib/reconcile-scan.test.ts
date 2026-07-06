import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { findMergeCommitForRun } from '../../lib/reconcile-scan.js'
import type { RunId } from '@ductum/core'

const execFileAsync = promisify(execFile)

describe('findMergeCommitForRun', () => {
  it('does not trust a reused branch when a recorded commit was never merged', async () => {
    const fixture = await setupReusedBranchFixture()
    try {
      const merge = await findMergeCommitForRun(
        fixture.repo,
        'main',
        'run-with-recorded-commit' as RunId,
        'feature/x',
        fixture.oldCommit,
      )

      expect(merge).toBeNull()
      await expect(findMergeCommitForRun(
        fixture.repo,
        'main',
        'branch-only-run' as RunId,
        'feature/x',
        null,
      )).resolves.toMatch(/^[0-9a-f]{40}$/)
    } finally {
      await fixture.cleanup()
    }
  })
})

async function setupReusedBranchFixture(): Promise<{
  repo: string
  oldCommit: string
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'ductum-reconcile-scan-'))
  const repo = join(root, 'repo')
  await git(root, ['init', '-b', 'main', repo])
  await git(repo, ['config', 'user.email', 'test@example.com'])
  await git(repo, ['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), '# initial\n')
  await git(repo, ['add', 'README.md'])
  await git(repo, ['commit', '-m', 'initial'])

  await git(repo, ['checkout', '-b', 'feature/x'])
  await writeFile(join(repo, 'old.txt'), 'old branch contents\n')
  await git(repo, ['add', 'old.txt'])
  await git(repo, ['commit', '-m', 'old feature'])
  const oldCommit = await gitStdout(repo, ['rev-parse', 'HEAD'])

  await git(repo, ['checkout', 'main'])
  await git(repo, ['branch', '-f', 'feature/x', 'main'])
  await git(repo, ['checkout', 'feature/x'])
  await writeFile(join(repo, 'new.txt'), 'reused branch contents\n')
  await git(repo, ['add', 'new.txt'])
  await git(repo, ['commit', '-m', 'new feature'])
  await git(repo, ['checkout', 'main'])
  await git(repo, ['merge', '--no-ff', '-m', 'chore(merge): integrate approved branch changes', 'feature/x'])

  return { repo, oldCommit, cleanup: async () => { await rm(root, { recursive: true, force: true }) } }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', cwd, ...args])
}

async function gitStdout(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf-8' })
  return stdout.trim()
}
