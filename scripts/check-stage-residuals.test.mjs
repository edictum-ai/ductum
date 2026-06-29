import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkStageResiduals } from './check-stage-residuals.mjs'

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('check-stage-residuals', () => {
  it('passes when directive, decision, AGENTS rule, and template mention exist', () => {
    const root = tempDir()
    writeEvidence(root)

    const result = checkStageResiduals({ root })

    expect(result.violations).toEqual([])
    expect(result.checked).toBeGreaterThan(0)
  })

  it('flags a missing directive marker', () => {
    const root = tempDir()
    writeEvidence(root, {
      'docs/STAGE_RESIDUAL_PINNING.md': [
        '# Stage Residual Pinning',
        'A stage may close with residuals only when each residual carries at least one',
        'of these pins:',
        '**Fix**',
        '**Test pinning current behavior**',
        // missing **Decision reference** marker
        'A residual with none of these pins fails closed',
      ].join('\n'),
    })

    const result = checkStageResiduals({ root })

    expect(result.violations).toContainEqual(expect.objectContaining({
      file: 'docs/STAGE_RESIDUAL_PINNING.md',
      marker: '**Decision reference**',
    }))
  })

  it('flags a missing stage template mention', () => {
    const root = tempDir()
    writeEvidence(root, {
      'specs/current/post-p9-hardening/README.md': [
        '# Post-P9 Hardening',
        // missing the residual-pinning bullet and Stage Template section
      ].join('\n'),
    })

    const result = checkStageResiduals({ root })

    expect(result.violations.some((v) => v.file === 'specs/current/post-p9-hardening/README.md')).toBe(true)
  })
})

function tempDir() {
  const dir = join(tmpdir(), `ductum-stage-residuals-${process.pid}-${dirs.length}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeEvidence(root, overrides = {}) {
  writeFile(root, 'docs/STAGE_RESIDUAL_PINNING.md', `
    # Stage Residual Pinning
    A stage may close with residuals only when each residual carries at least one
    of these pins:
    **Fix**
    a committed SHA or a merged PR
    are not durable fixes
    **Test pinning current behavior**
    **Decision reference**
    A residual with none of these pins fails closed
  `)
  writeFile(root, 'decisions/185-stage-residual-pinning-directive.md', `
    # D185 — Stage residual pinning directive
    Linked: GitHub issue #56
    A stage may close with residuals only when each residual carries at least one
    of these pins: **Fix** (a committed SHA or a merged PR; mutable references
    are not durable fixes), **Test pinning current behavior**, **Decision reference**.
    A residual with none of these pins fails closed.
  `)
  writeFile(root, 'AGENTS.md', `
    A stage may close with residuals only when each residual carries a fix, a
    test pinning current behavior, or a decision reference.
    See docs/STAGE_RESIDUAL_PINNING.md.
  `)
  writeFile(root, 'specs/current/post-p9-hardening/README.md', `
    Require every stage-close residual to be pinned by a fix, a test pinning
    current behavior, or a decision reference.
    Stage templates mention residual pinning.
    ## Residuals
  `)
  for (const [file, text] of Object.entries(overrides)) writeFile(root, file, text)
}

function writeFile(root, relPath, text) {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, `${text.trim()}\n`)
}
