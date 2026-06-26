import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkReadinessFailingPaths } from './check-readiness-failing-paths.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-readiness-failing-paths', () => {
  it('flags producers that lack failing-path evidence', () => {
    const root = tempDir()
    writeSource(root, 'packages/core/src/tests/repository-model.test.ts', `it('happy path', () => {})`)

    const result = checkReadinessFailingPaths({
      root,
      producers: [
        {
          name: 'repositoryReadiness',
          source: 'packages/core/src/repository-model.ts',
          testFile: 'packages/core/src/tests/repository-model.test.ts',
          pattern: 'failing-path evidence',
          mode: 'failing-path',
        },
      ],
    })

    expect(result).toEqual({
      checked: 1,
      violations: [
        expect.objectContaining({
          producer: 'repositoryReadiness',
          reason: 'missing failing-path evidence: "failing-path evidence"',
        }),
      ],
    })
  })

  it('accepts producers with failing-path evidence', () => {
    const root = tempDir()
    writeSource(root, 'packages/core/src/tests/repository-model.test.ts', `
      it('produces failing-path readiness states for repositories without remote or GitHub support', () => {})
    `)

    const result = checkReadinessFailingPaths({
      root,
      producers: [
        {
          name: 'repositoryReadiness',
          source: 'packages/core/src/repository-model.ts',
          testFile: 'packages/core/src/tests/repository-model.test.ts',
          pattern: 'produces failing-path readiness states for repositories without remote or GitHub support',
          mode: 'failing-path',
        },
      ],
    })

    expect(result).toEqual({ checked: 1, violations: [] })
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-readiness-checks-${process.pid}-${dirs.length}`)
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
