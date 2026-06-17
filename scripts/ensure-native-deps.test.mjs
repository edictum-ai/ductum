import { describe, expect, it, vi } from 'vitest'

import { ensureNativeDependencies, shouldRebuildBetterSqlite } from './ensure-native-deps.mjs'

describe('native dependency bootstrap', () => {
  it('does nothing when better-sqlite3 can load', () => {
    const run = vi.fn()

    const result = ensureNativeDependencies({
      load: () => ({ ok: true }),
      run,
    })

    expect(result).toEqual({ rebuilt: false })
    expect(run).not.toHaveBeenCalled()
  })

  it('rebuilds only the approved better-sqlite3 dependency when the native binding is missing', () => {
    const run = vi.fn().mockReturnValue({ status: 0 })
    let attempts = 0

    const result = ensureNativeDependencies({
      load: () => {
        attempts++
        return attempts === 1
          ? { ok: false, error: new Error('Could not locate the bindings file for better_sqlite3.node') }
          : { ok: true }
      },
      run,
      log: vi.fn(),
    })

    expect(result).toEqual({ rebuilt: true })
    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['--filter', '@ductum/core', '--config.ignore-scripts=false', 'rebuild', 'better-sqlite3'],
      { stdio: 'inherit' },
    )
  })

  it('prints the exact manual command when rebuild fails', () => {
    expect(() =>
      ensureNativeDependencies({
        load: () => ({ ok: false, error: new Error('better_sqlite3.node missing') }),
        run: vi.fn().mockReturnValue({ status: 1 }),
        log: vi.fn(),
      }),
    ).toThrow('pnpm --filter @ductum/core --config.ignore-scripts=false rebuild better-sqlite3')
  })

  it('only treats native better-sqlite3 load errors as rebuildable', () => {
    expect(shouldRebuildBetterSqlite(new Error('Could not locate better_sqlite3.node'))).toBe(true)
    expect(shouldRebuildBetterSqlite(new Error('syntax error in user code'))).toBe(false)
  })
})
