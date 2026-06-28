import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkConservativeDefaults } from './check-conservative-defaults.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-conservative-defaults', () => {
  it('passes when directive, rule, and evidence markers exist', () => {
    const root = tempDir()
    writeEvidence(root)

    const result = checkConservativeDefaults({ root })

    expect(result.violations).toEqual([])
    expect(result.checked).toBeGreaterThan(0)
  })

  it('flags missing project route marker when the default relaxes to auto', () => {
    const root = tempDir()
    writeEvidence(root, {
      'packages/api/src/routes/projects.ts': "mergeMode: 'human'",
    })

    const result = checkConservativeDefaults({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: 'packages/api/src/routes/projects.ts',
      marker: "config.mergeMode === 'auto' ? 'auto' : 'human'",
    }))
  })

  it('flags missing conservative-defaults test markers', () => {
    const root = tempDir()
    writeEvidence(root, {
      'packages/api/src/tests/conservative-defaults.test.ts': 'defaults project mergeMode to auto when the request omits it',
    })

    const result = checkConservativeDefaults({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: 'packages/api/src/tests/conservative-defaults.test.ts',
      marker: 'defaults project mergeMode to human when the request omits it',
    }))
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-conservative-defaults-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeEvidence(root, overrides = {}) {
  writeFile(root, 'AGENTS.md', `
    Conservative defaults for new records: every producer that mints a merge, dispatch, or approval default must pick the protective mode.
    \`mergeMode\` defaults to \`human\` (never \`auto\`); unattended approval, merge, and push stay blocked unless the workflow profile explicitly allows them.
  `)
  writeFile(root, 'decisions/185-conservative-defaults.md', `
    # D185 — Conservative defaults for new records
    Merge mode defaults to \`human\`. Dispatch defaults to off. Approval defaults to required. Silent regressions are not acceptable.
  `)
  writeFile(root, 'packages/api/src/routes/projects.ts', `
    mergeMode: config.mergeMode === 'auto' ? 'auto' : 'human',
  `)
  writeFile(root, 'packages/core/src/factory-seed.ts', `
    config: { mergeMode: 'human', workflowPath: 'workflows/coding-guard.yaml' }, // D185: conservative default
  `)
  writeFile(root, 'packages/api/src/tests/conservative-defaults.test.ts', `
    defaults project mergeMode to human when the request omits it
    falls back to human mergeMode when the request supplies an unrecognized value
    only opts in to auto mergeMode with an explicit auto value
    preserves an explicit auto opt-in on update but never relaxes to auto implicitly
  `)
  writeFile(root, 'packages/core/src/tests/factory-seed.test.ts', `
    seeds the initial project with the D185 conservative mergeMode default
    toBe('human')
  `)
  writeFile(root, 'packages/core/src/tests/unattended-approval-policy.test.ts', `
    keeps manual approval as default by blocking absent workflow policy
    'workflow does not define unattended approval policy'
  `)
  for (const [file, text] of Object.entries(overrides)) writeFile(root, file, text)
}

function writeFile(root, relPath, text) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, `${text.trim()}\n`)
}
