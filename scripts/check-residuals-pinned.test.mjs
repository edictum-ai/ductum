import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkResidualsPinned } from './check-residuals-pinned.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-residuals-pinned', () => {
  it('passes when directive, repo rule, and stage-template markers exist', () => {
    const root = tempDir()
    writeEvidence(root)

    const result = checkResidualsPinned({ root })

    expect(result.violations).toEqual([])
    expect(result.checked).toBeGreaterThan(0)
  })

  it('flags missing decision marker', () => {
    const root = tempDir()
    writeEvidence(root, {
      'decisions/185-residuals-pinned-before-close.md': 'residual pinning guard placeholder',
    })

    const result = checkResidualsPinned({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: 'decisions/185-residuals-pinned-before-close.md',
      marker: '# D185 - Stage residuals must be pinned before a stage closes',
    }))
  })

  it('flags stage template that drops residual pinning section', () => {
    const root = tempDir()
    writeEvidence(root, {
      '.agents/skills/ductum-spec-authoring/SKILL.md': 'no residual pinning section here',
    })

    const result = checkResidualsPinned({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: '.agents/skills/ductum-spec-authoring/SKILL.md',
      marker: 'Residual pinning',
    }))
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-residuals-pinned-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeEvidence(root, overrides = {}) {
  writeFile(root, 'AGENTS.md', `
    Stage residuals must be pinned before the stage closes.
    Prose-only acknowledgment is not a pin.
  `)
  writeFile(root, 'decisions/185-residuals-pinned-before-close.md', `
    # D185 - Stage residuals must be pinned before a stage closes
    A residual is pinned when it has at least one of: fix, test, or decision.
    decisions/<NNN>-*.md
  `)
  writeFile(root, '.agents/skills/ductum-spec-authoring/SKILL.md', `
    Residual pinning
    A stage may close with residuals only when each residual is pinned.
    decisions/185-residuals-pinned-before-close.md
  `)
  for (const [file, text] of Object.entries(overrides)) writeFile(root, file, text)
}

function writeFile(root, relPath, text) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, `${text.trim()}\n`)
}
