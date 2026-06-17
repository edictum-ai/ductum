import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * D163 §§1-3 — drift guard.
 *
 * The dashboard MUST import `RunUiContract`, `UiTone`, `RunUiStatusKey`,
 * and `UiCostState` from `@ductum/ui-contract` (the canonical
 * declaration in `@ductum/api/lib/ui-contract-types`). Re-declaring any
 * of these interfaces inside the dashboard would re-introduce the exact
 * fork that ADR 0163 collapsed.
 *
 * This test walks the dashboard source tree and fails if it finds fresh
 * declarations for canonical UI or operator contract types. The dashboard
 * may re-export those types from `src/api/client.ts`, but it must not
 * redefine their shapes locally.
 */

const SOURCE_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const TEST_DIR = path.resolve(SOURCE_ROOT, 'tests')

const FORBIDDEN_DECLARATIONS: Array<{ symbol: string; regex: RegExp }> = [
  { symbol: 'RunUiContract', regex: /\b(?:interface|type)\s+RunUiContract\b/ },
  { symbol: 'UiTone', regex: /\b(?:type|interface)\s+UiTone\b/ },
  { symbol: 'RunUiStatusKey', regex: /\b(?:type|interface)\s+RunUiStatusKey\b/ },
  { symbol: 'UiCostState', regex: /\b(?:type|interface)\s+UiCostState\b/ },
  { symbol: 'OperatorProject', regex: /\b(?:interface|type)\s+OperatorProject\b/ },
  { symbol: 'OperatorAttempt', regex: /\b(?:interface|type)\s+OperatorAttempt\b/ },
  { symbol: 'OperatorTask', regex: /\b(?:interface|type)\s+OperatorTask\b/ },
  { symbol: 'SpecIntake', regex: /\b(?:interface|type)\s+SpecIntake\b/ },
  { symbol: 'WorkPackage', regex: /\b(?:interface|type)\s+WorkPackage\b/ },
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
    if (full.endsWith('.ts') || full.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

describe('dashboard contract drift guard (D163 §§1-3)', () => {
  it('no dashboard source file declares the canonical run UI types locally', () => {
    const offenders: Array<{ file: string; symbol: string; line: number }> = []
    for (const file of listSourceFiles(SOURCE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx]!
        // Allow `export type {... }` re-export forms — they reference,
        // not declare. Only flag fresh `interface X` / `type X = ...` heads.
        if (/^\s*export\s+type\s*\{/.test(line)) continue
        if (/^\s*import\s/.test(line)) continue
        for (const { symbol, regex } of FORBIDDEN_DECLARATIONS) {
          if (regex.test(line)) {
            offenders.push({ file: path.relative(SOURCE_ROOT, file), symbol, line: idx + 1 })
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('client.ts re-exports the canonical UI contract types from @ductum/ui-contract', () => {
    const clientPath = path.resolve(SOURCE_ROOT, 'api/client.ts')
    const text = readFileSync(clientPath, 'utf8')
    expect(text).toMatch(/export\s+type\s*\{[^}]*RunUiContract[^}]*\}\s*from\s*'@ductum\/ui-contract'/)
    expect(text).toMatch(/from\s*'@ductum\/ui-contract'/)
  })

  it('client.ts re-exports the canonical operator contract types from @ductum/operator-contract', () => {
    const clientPath = path.resolve(SOURCE_ROOT, 'api/client.ts')
    const text = readFileSync(clientPath, 'utf8')
    expect(text).toMatch(/export\s+type\s*\{[^}]*OperatorProject[^}]*WorkPackage[^}]*\}\s*from\s*'@ductum\/operator-contract'/s)
    expect(text).toMatch(/from\s*'@ductum\/operator-contract'/)
  })
})
