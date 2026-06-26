/**
 * Direct tests for autoCommitWorktree against a real temp git repo.
 *
 * This helper exists because the Codex SDK harness leaves worktrees
 * with uncommitted/untracked files when small tasks finish, and the
 * downstream rebase/verify/merge steps all require a clean worktree.
 * The tests below mirror the live failure modes we observed.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { autoCommitWorktree } from '../auto-commit.js'

const gitFixtureTimeoutMs = 20_000

describe('autoCommitWorktree', () => {
  let repo: string
  let parent: string

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-autocommit-'))
    repo = path.join(parent, 'repo')
    fs.mkdirSync(repo)
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
    git('init', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n')
    git('add', '.')
    git('commit', '--no-verify', '-m', 'base')
  }, gitFixtureTimeoutMs)

  afterEach(() => {
    if (parent != null) fs.rmSync(parent, { recursive: true, force: true })
  })

  it('returns committed=false on a clean worktree', async () => {
    const result = await autoCommitWorktree(repo, 'P1-CLEAN')
    expect(result.dirty).toBe(false)
    expect(result.committed).toBe(false)
    expect(result.error).toBeUndefined()

    // Confirm git history was untouched: still one commit.
    const log = execFileSync('git', ['-C', repo, 'log', '--oneline'], { encoding: 'utf-8' })
    expect(log.trim().split('\n')).toHaveLength(1)
  }, gitFixtureTimeoutMs)

  it('commits untracked files left behind by the agent (the live Codex bug)', async () => {
    // Reproduce the exact shape from SCANNER-VERIFY-CODEX: untracked
    // files in nested directories that codex Wrote but never committed.
    fs.mkdirSync(path.join(repo, 'packages/core/src/utils'), { recursive: true })
    fs.mkdirSync(path.join(repo, 'packages/core/src/tests'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'packages/core/src/utils/noop.ts'), 'export const noop = () => undefined\n')
    fs.writeFileSync(path.join(repo, 'packages/core/src/tests/utils-noop.test.ts'), '// test stub\n')

    const result = await autoCommitWorktree(repo, 'SCANNER-VERIFY-CODEX')
    expect(result.dirty).toBe(true)
    expect(result.committed).toBe(true)
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)

    // Worktree should now be clean.
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(status.trim()).toBe('')

    // The untracked files should have landed in the auto-commit.
    const lastCommitFiles = execFileSync(
      'git',
      ['-C', repo, 'show', '--name-only', '--pretty=format:', 'HEAD'],
      { encoding: 'utf-8' },
    )
    expect(lastCommitFiles).toContain('packages/core/src/utils/noop.ts')
    expect(lastCommitFiles).toContain('packages/core/src/tests/utils-noop.test.ts')
  }, gitFixtureTimeoutMs)

  it('commits modified-tracked files alongside untracked ones', async () => {
    fs.appendFileSync(path.join(repo, 'base.txt'), 'modified line\n')
    fs.writeFileSync(path.join(repo, 'new.txt'), 'brand new\n')

    const result = await autoCommitWorktree(repo, 'P-MIXED')
    expect(result.committed).toBe(true)

    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf-8' })
    expect(status.trim()).toBe('')

    const lastCommitFiles = execFileSync(
      'git',
      ['-C', repo, 'show', '--name-only', '--pretty=format:', 'HEAD'],
      { encoding: 'utf-8' },
    )
    expect(lastCommitFiles).toContain('base.txt')
    expect(lastCommitFiles).toContain('new.txt')
  }, gitFixtureTimeoutMs)

  it('embeds the task name in the commit message and uses the synthetic author', async () => {
    fs.writeFileSync(path.join(repo, 'foo.txt'), 'foo\n')

    const result = await autoCommitWorktree(repo, 'P3-PROJECT-CONTROL')
    expect(result.committed).toBe(true)

    const subject = execFileSync(
      'git',
      ['-C', repo, 'log', '-1', '--format=%s'],
      { encoding: 'utf-8' },
    ).trim()
    expect(subject).toBe('chore(auto-commit): finalize PROJECT-CONTROL')

    const author = execFileSync(
      'git',
      ['-C', repo, 'log', '-1', '--format=%an <%ae>'],
      { encoding: 'utf-8' },
    ).trim()
    expect(author).toBe('ductum-auto-commit <auto-commit@ductum.local>')
  }, gitFixtureTimeoutMs)

  it('strips imported planning prefixes from the generated commit subject', async () => {
    fs.writeFileSync(path.join(repo, 'proof.txt'), 'proof\n')

    const result = await autoCommitWorktree(repo, '[post-P9 P4] Document one shared secret validator for every config write path')
    expect(result.committed).toBe(true)

    const subject = execFileSync(
      'git',
      ['-C', repo, 'log', '-1', '--format=%s'],
      { encoding: 'utf-8' },
    ).trim()
    expect(subject).toBe('chore(auto-commit): finalize Document one shared secret validator for every config write path')
    expect(subject).not.toMatch(/\[post-P\d+\s+P\d+\]|(?:^| )P\d+(?:$| )|p-[a-z0-9-]+/i)
  }, gitFixtureTimeoutMs)

  it('commits staged-but-not-committed changes too', async () => {
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n')
    execFileSync('git', ['-C', repo, 'add', 'staged.txt'], { stdio: 'pipe' })

    const result = await autoCommitWorktree(repo, 'P-STAGED')
    expect(result.committed).toBe(true)

    const lastCommitFiles = execFileSync(
      'git',
      ['-C', repo, 'show', '--name-only', '--pretty=format:', 'HEAD'],
      { encoding: 'utf-8' },
    )
    expect(lastCommitFiles).toContain('staged.txt')
  }, gitFixtureTimeoutMs)

  it('returns an error when the worktree path is not a git repo', async () => {
    const notARepo = path.join(parent, 'not-a-repo')
    fs.mkdirSync(notARepo)
    fs.writeFileSync(path.join(notARepo, 'file.txt'), 'hi\n')

    const result = await autoCommitWorktree(notARepo, 'P-BROKEN')
    expect(result.committed).toBe(false)
    expect(result.error).toBeDefined()
  }, gitFixtureTimeoutMs)

  it('short-circuits synchronously when the worktree path does not exist', async () => {
    const ghost = path.join(parent, 'ghost-worktree')
    const result = await autoCommitWorktree(ghost, 'P-GHOST')
    expect(result.committed).toBe(false)
    expect(result.dirty).toBe(false)
    expect(result.error).toBe('worktree path does not exist')
  }, gitFixtureTimeoutMs)
})
