import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import { ensureWorktreeNodeModules } from './ensure-worktree-node-modules.mjs'

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ductum-worktree-modules-'))
  mkdirSync(join(root, 'packages'), { recursive: true })
  return root
}

describe('ensureWorktreeNodeModules', () => {
  it('does nothing in the main checkout', () => {
    const root = makeRepo()
    const run = vi.fn((_, args) => {
      if (args[1] === '--show-toplevel') return root
      return join(root, '.git')
    })

    expect(ensureWorktreeNodeModules({ cwd: root, run, log: vi.fn() })).toEqual({
      linked: false,
      reason: 'not-worktree',
    })
  })

  it('links root node_modules and mirrors package node_modules entries for worktrees', () => {
    const worktreeRoot = makeRepo()
    const sourceRoot = makeRepo()
    mkdirSync(join(sourceRoot, 'node_modules'))
    mkdirSync(join(worktreeRoot, 'packages', 'core'), { recursive: true })
    mkdirSync(join(worktreeRoot, 'packages', 'landing'), { recursive: true })
    mkdirSync(join(sourceRoot, 'packages', 'core', 'node_modules'), { recursive: true })
    mkdirSync(join(sourceRoot, 'packages', 'landing', 'node_modules'), { recursive: true })
    mkdirSync(join(sourceRoot, 'packages', 'core', 'node_modules', '.bin'))
    mkdirSync(join(sourceRoot, 'packages', 'landing', 'node_modules', '.bin'))
    mkdirSync(join(sourceRoot, 'packages', 'landing', 'node_modules', '.vite-temp'))

    const linked = []
    const made = []
    const run = vi.fn((_, args) => {
      if (args[1] === '--show-toplevel') return worktreeRoot
      return join(sourceRoot, '.git')
    })

    expect(
      ensureWorktreeNodeModules({
        cwd: worktreeRoot,
        run,
        link: (target, source) => linked.push({ target, source }),
        mkdir: (target) => made.push(target),
        log: vi.fn(),
      }),
    ).toEqual({ linked: true, reason: 'linked' })
    expect(made).toEqual([
      join(worktreeRoot, 'packages', 'core', 'node_modules'),
      join(worktreeRoot, 'packages', 'landing', 'node_modules'),
    ])
    expect(linked).toEqual([
      {
        target: join(worktreeRoot, 'node_modules'),
        source: join(sourceRoot, 'node_modules'),
      },
      {
        target: join(worktreeRoot, 'packages', 'core', 'node_modules', '.bin'),
        source: join(sourceRoot, 'packages', 'core', 'node_modules', '.bin'),
      },
      {
        target: join(worktreeRoot, 'packages', 'landing', 'node_modules', '.bin'),
        source: join(sourceRoot, 'packages', 'landing', 'node_modules', '.bin'),
      },
    ])
  })
})
