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
  it('passes when directive and failing-path evidence markers exist', () => {
    const root = tempDir()
    writeEvidence(root)

    const result = checkReadinessFailingPaths({ root })

    expect(result.violations).toEqual([])
    expect(result.checked).toBeGreaterThan(0)
  })

  it('flags missing failing-path evidence', () => {
    const root = tempDir()
    writeEvidence(root, {
      'packages/core/src/tests/repair-readiness-states.test.ts': 'covers failed readiness producers with repair items',
    })

    const result = checkReadinessFailingPaths({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: 'packages/core/src/tests/repair-readiness-states.test.ts',
      marker: 'host:git:missing',
    }))
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-readiness-paths-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeEvidence(root, overrides = {}) {
  writeFile(root, 'AGENTS.md', `
    Readiness/repair producers must have failing-path coverage before they become readiness gates.
    If a check cannot fail in tests, remove it or mark it as asserted instead of presenting it as proof.
  `)
  writeFile(root, 'decisions/184-no-always-green-readiness-checks.md', `
    # D184 - Readiness checks need failing-path proof
    Every readiness or repair producer that can block operator trust must have at least one failing-path test before it ships.
  `)
  writeFile(root, 'packages/core/src/tests/repair-readiness-states.test.ts', `
    covers failed readiness producers with repair items
    factory:dispatcher-disabled
    host:git:missing
    factory:data-dir:writable
    factory:local-app-port
    attempt-recovery:needs-operator
    provider:anthropic:auth:missing
    local-git:missing
    github-auth:missing
  `)
  writeFile(root, 'packages/api/src/tests/repair.routes.test.ts', `
    reports missing remote and GitHub auth before Attempt start
    rejects legacy accept before Attempt start when prerequisites fail
    fails accept closed when dispatch prerequisite context is missing
  `)
  writeFile(root, 'packages/core/src/tests/repair-workflow-validity.test.ts', `
    targets the validity blocker at the referencing project and keeps siblings eligible
    keeps ambiguous legacy workflowProfile names unresolved instead of picking one record
  `)
  for (const [file, text] of Object.entries(overrides)) writeFile(root, file, text)
}

function writeFile(root, relPath, text) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, `${text.trim()}\n`)
}
