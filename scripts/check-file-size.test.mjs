import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkFileSizes, countLines } from './check-file-size.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-file-size', () => {
  it('fails files over the limit when they are not grandfathered', () => {
    const root = tempDir()
    writeSource(root, 'packages/core/src/oversized.ts', 301)

    const result = checkFileSizes({ root })

    expect(result.violations).toEqual([
      expect.objectContaining({
        lines: 301,
        overBy: 1,
        path: 'packages/core/src/oversized.ts',
      }),
    ])
  })

  it('accepts files listed in the grandfather decision', () => {
    const root = tempDir()
    writeSource(root, 'packages/core/src/legacy.ts', 320)
    writeSource(root, 'packages/dashboard/src/LegacyPage.tsx', 321)
    writeDecision(
      root,
      '| LOC | File | P7 tag | Rationale |\n' +
        '|---:|---|---|---|\n' +
        '| 320 | `packages/core/src/legacy.ts` | P7.4 | Legacy split pending. |\n' +
        '| 321 | `packages/dashboard/src/LegacyPage.tsx` | P7.4 | Legacy split pending. |\n',
    )

    const result = checkFileSizes({ root })

    expect(result.grandfatherList.path).toBe('decisions/112-file-size-grandfather-list.md')
    expect(result.oversized).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'packages/core/src/legacy.ts' }),
      expect.objectContaining({ path: 'packages/dashboard/src/LegacyPage.tsx' }),
    ]))
    expect(result.violations).toEqual([])
  })

  it('ignores dist, node_modules, and declaration files', () => {
    const root = tempDir()
    writeSource(root, 'packages/core/dist/generated.ts', 500)
    writeSource(root, 'packages/core/node_modules/vendor/index.ts', 500)
    writeSource(root, 'packages/core/src/generated.d.ts', 500)

    const result = checkFileSizes({ root })

    expect(result.scanned).toBe(0)
    expect(result.violations).toEqual([])
  })

  it('counts newline-terminated and unterminated files consistently', () => {
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('')).toBe(0)
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-file-size-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeSource(root, relPath, lines) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, Array.from({ length: lines }, (_, index) => `const line${index} = ${index}`).join('\n') + '\n')
}

function writeDecision(root, text) {
  const dir = join(root, 'decisions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '112-file-size-grandfather-list.md'), text)
}
