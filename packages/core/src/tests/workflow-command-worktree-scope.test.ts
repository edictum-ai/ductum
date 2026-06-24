import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateWorktreePathScope } from '../workflow-command-worktree-scope.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-worktree-scope-'))
  tempDirs.push(dir)
  return dir
}

describe('validateWorktreePathScope', () => {
  it('blocks out-of-worktree absolute Bash read and navigation forms', () => {
    const baseDir = makeBaseDir()

    expect(validateWorktreePathScope('cat /etc/passwd', { baseDir })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('/etc/passwd'),
    })
    expect(validateWorktreePathScope('cd /tmp && pwd', { baseDir })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('/tmp'),
    })
    expect(validateWorktreePathScope('pushd /var/tmp', { baseDir })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('/var/tmp'),
    })
    expect(validateWorktreePathScope('git -C /usr/local status', { baseDir })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('/usr/local'),
    })
  })

  it('blocks chained variants that reach outside the worktree', () => {
    const baseDir = makeBaseDir()

    expect(validateWorktreePathScope('printf ok && cd /tmp', { baseDir }).allowed).toBe(false)
    expect(validateWorktreePathScope('printf ok; cat /etc/passwd', { baseDir }).allowed).toBe(false)
    expect(validateWorktreePathScope('echo ok\n git -C /usr/local status', { baseDir }).allowed).toBe(false)
  })

  it('allows relative paths and absolute paths inside the worktree', () => {
    const baseDir = makeBaseDir()
    const insideFile = `${baseDir}/README.md`
    const insideDir = `${baseDir}/packages/core`

    expect(validateWorktreePathScope('cat README.md', { baseDir })).toEqual({ allowed: true })
    expect(validateWorktreePathScope(`cat ${insideFile}`, { baseDir })).toEqual({ allowed: true })
    expect(validateWorktreePathScope('cd packages/core && rg Ductum README.md', { baseDir })).toEqual({
      allowed: true,
    })
    expect(validateWorktreePathScope(`git -C ${insideDir} status`, { baseDir })).toEqual({
      allowed: true,
    })
  })

  it('does not mistake grep or sed patterns for path arguments', () => {
    const baseDir = makeBaseDir()
    const insideFile = `${baseDir}/README.md`

    expect(validateWorktreePathScope(`grep /tmp ${insideFile}`, { baseDir })).toEqual({ allowed: true })
    expect(validateWorktreePathScope(`rg /etc/passwd README.md`, { baseDir })).toEqual({ allowed: true })
    expect(validateWorktreePathScope(`sed -n /tmp/p ${insideFile}`, { baseDir })).toEqual({ allowed: true })
  })

  it('fails closed for ambiguous targeted path references', () => {
    const baseDir = makeBaseDir()

    const homeResult = validateWorktreePathScope('cat "$HOME/.zshrc"', { baseDir })
    const tildeResult = validateWorktreePathScope('git -C ~/repo status', { baseDir })

    expect(homeResult.allowed).toBe(false)
    expect(homeResult.reason).toContain('$HOME/.zshrc')
    expect(homeResult.reason).toContain('could not be verified')
    expect(tildeResult.allowed).toBe(false)
    expect(tildeResult.reason).toContain('~/repo')
  })
})
