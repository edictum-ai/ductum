#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const coreRequire = createRequire(new URL('../packages/core/package.json', import.meta.url))

export function loadBetterSqlite(requireFn = coreRequire) {
  try {
    const Database = requireFn('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

export function shouldRebuildBetterSqlite(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /better[-_]sqlite3|bindings file|better_sqlite3\.node|ERR_DLOPEN_FAILED|Cannot find module/i.test(message)
}

export function rebuildBetterSqlite({ run = spawnSync, log = console.log } = {}) {
  log('better-sqlite3 native binding missing; rebuilding approved dependency with scripts enabled for @ductum/core only.')
  return run('pnpm', ['--filter', '@ductum/core', '--config.ignore-scripts=false', 'rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
  })
}

export function ensureNativeDependencies(options = {}) {
  const load = options.load ?? (() => loadBetterSqlite(options.requireFn))
  const first = load()
  if (first.ok) return { rebuilt: false }
  if (!shouldRebuildBetterSqlite(first.error)) throw first.error

  const result = rebuildBetterSqlite({ run: options.run, log: options.log })
  if (result.status !== 0) {
    throw new Error(
      'Failed to rebuild better-sqlite3. Install a C++ toolchain, then run: pnpm --filter @ductum/core --config.ignore-scripts=false rebuild better-sqlite3',
    )
  }

  const second = load()
  if (!second.ok) throw second.error
  return { rebuilt: true }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    ensureNativeDependencies()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
