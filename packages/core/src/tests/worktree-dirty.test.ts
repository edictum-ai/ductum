import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { inspectDirtyWorktree, readTrackedWorktreeChanges } from '../worktree-dirty.js'

const cleanup: string[] = []

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('worktree dirty inspection', () => {
  it('returns tracked and untracked source files', async () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.ts'), 'export const tracked = 2\n')
    writeFileSync(join(repo, 'untracked.ts'), 'export const untracked = true\n')

    const snapshot = await inspectDirtyWorktree(repo)

    expect(snapshot.trackedPaths).toEqual(['tracked.ts'])
    expect(snapshot.untrackedPaths).toEqual(['untracked.ts'])
    expect(snapshot.relevantPaths).toEqual(['tracked.ts', 'untracked.ts'])
    expect(snapshot.ignoredPaths).toEqual([])
  })

  it('ignores .pnpm-store cache noise when no source files changed', async () => {
    const repo = createRepo()
    const cacheDir = join(repo, '.pnpm-store', 'v3')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'index.json'), '{}\n')

    const snapshot = await inspectDirtyWorktree(repo)

    expect(snapshot.relevantPaths).toEqual([])
    expect(snapshot.ignoredPaths).toEqual(['.pnpm-store/v3/index.json'])
  })

  it('reports tracked changes without treating generated untracked cache noise as source dirtiness', async () => {
    const repo = createRepo()
    writeFileSync(join(repo, 'tracked.ts'), 'export const tracked = 2\n')
    const cacheDir = join(repo, '.pnpm-store')
    mkdirSync(cacheDir)
    writeFileSync(join(cacheDir, 'noise.txt'), 'cache\n')

    const result = await readTrackedWorktreeChanges(repo)

    expect(result.error).toBeUndefined()
    expect(result.files).toEqual(['M tracked.ts'])
    expect(result.files.join('\n')).not.toContain('.pnpm-store')
  })
})

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ductum-dirty-'))
  cleanup.push(repo)
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
  writeFileSync(join(repo, 'tracked.ts'), 'export const tracked = 1\n')
  execFileSync('git', ['-C', repo, 'add', 'tracked.ts'])
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed'])
  return repo
}
