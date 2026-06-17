import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * D163 §6 — harness package owns adapter implementations, NOT the
 * canonical contract. `@ductum/core` is the single declaration site
 * for `HarnessSession`, `HarnessAdapter`, `HarnessEvent`, etc. This
 * file walks the harness source tree and fails if anyone reintroduces
 * a parallel declaration of those shapes (the exact regression that
 * P4 collapsed).
 *
 * The companion test in `contract.test.ts` pins the relationship at
 * the type level (`expectTypeOf<HarnessAdapter>().toEqualTypeOf<...>`).
 * This test pins it at the *source* level — even an identical-looking
 * fresh declaration shouldn't appear in this package.
 */

const SOURCE_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const TEST_DIR = path.resolve(SOURCE_ROOT, 'tests')
const TYPES_SHIM = path.resolve(SOURCE_ROOT, 'types.ts')

const FORBIDDEN_SYMBOLS = [
  'HarnessAdapter',
  'HarnessSession',
  'HarnessSessionResult',
  'HarnessKillReason',
  'HarnessEvent',
  'TokenUsageDelta',
  'ReattachContext',
  'SpawnOptions',
]

function listSourceFiles(dir: string): string[] {
  const acc: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (full === TEST_DIR) continue
    const info = statSync(full)
    if (info.isDirectory()) {
      acc.push(...listSourceFiles(full))
      continue
    }
    if (full.endsWith('.ts')) acc.push(full)
  }
  return acc
}

describe('harness contract drift guard (D163 §6)', () => {
  it('no harness source file declares the canonical contract shapes locally', () => {
    const offenders: Array<{ file: string; symbol: string; line: number }> = []
    for (const file of listSourceFiles(SOURCE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx]!
        if (/^\s*export\s+type\s*\{/.test(line)) continue
        if (/^\s*import\s/.test(line)) continue
        for (const symbol of FORBIDDEN_SYMBOLS) {
          const decl = new RegExp(`\\b(?:interface|type)\\s+${symbol}\\b`)
          if (decl.test(line)) {
            offenders.push({ file: path.relative(SOURCE_ROOT, file), symbol, line: idx + 1 })
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('types.ts is a pure re-export shim from @ductum/core', () => {
    const text = readFileSync(TYPES_SHIM, 'utf8')
    // Only `export type { ... } from '@ductum/core'` statements — no
    // local declarations, no value runtime exports.
    expect(text).toMatch(/export\s+type\s*\{[\s\S]*\}\s*from\s*'@ductum\/core'/)
    expect(text).not.toMatch(/^\s*export\s+(?:interface|type)\s+\w+\s*=/m)
    expect(text).not.toMatch(/^\s*export\s+(?:const|function|class)\s+/m)
  })

  it('every built-in adapter file emits session.started with a harness session id', () => {
    const adapters = ['claude.ts', 'codex-app-server.ts', 'copilot-sdk.ts', 'opencode.ts']
    for (const adapter of adapters) {
      const text = readFileSync(path.resolve(SOURCE_ROOT, adapter), 'utf8')
      // Each adapter MUST emit a `session.started` event with a
      // `harnessSessionId` field (D162). Loosened to allow either
      // string literal `'session.started'` or `"session.started"` and
      // any whitespace between the type tag and the id field.
      expect(text, adapter).toMatch(/type:\s*['"]session\.started['"][\s\S]{0,200}harnessSessionId/)
    }
  })
})
