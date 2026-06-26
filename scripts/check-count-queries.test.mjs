import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkCountQueries } from './check-count-queries.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-count-queries', () => {
  it('flags default-limited run lists in reportish files', () => {
    const root = tempDir()
    writeSource(root, 'packages/api/src/lib/operator-brief.ts', `
      export function build(context) {
        return context.repos.runs.listAll().length
      }
    `)

    const result = checkCountQueries({ root })

    expect(result.scanned).toBe(1)
    expect(result.violations).toEqual([
      expect.objectContaining({
        file: 'packages/api/src/lib/operator-brief.ts',
        pattern: 'repos.runs.listAll',
      }),
    ])
  })

  it('allows explicit limits and ignores non-report files', () => {
    const root = tempDir()
    writeSource(root, 'packages/api/src/lib/operator-brief.ts', `
      export function build(context) {
        return context.repos.runs.listAll({ limit: null }).length
      }
    `)
    writeSource(root, 'packages/dashboard/src/pages/ApprovalQueue.tsx', `
      export function Page(api) {
        return api.listAllRuns({ stage: 'ship' })
      }
    `)

    const result = checkCountQueries({ root })

    expect(result.scanned).toBe(1)
    expect(result.violations).toEqual([])
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-count-query-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeSource(root, relPath, text) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, `${text.trim()}\n`)
}
