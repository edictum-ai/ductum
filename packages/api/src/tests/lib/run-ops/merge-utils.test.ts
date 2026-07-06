import { checkPublicGitMetadata, type RunId } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { buildMergeSubject } from '../../../lib/run-ops/merge-utils.js'

const runId = 'abcdef1234567890' as RunId

describe('buildMergeSubject', () => {
  it('rejects the previous public merge subject shape', () => {
    const oldSubject = 'Merge feat/x (run abcdef12)'

    expect(checkPublicGitMetadata(oldSubject)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('not conventional'),
      ]),
    })
  })

  it('emits a conventional branch-backed subject without raw branch or run labels', () => {
    const subject = buildMergeSubject(runId, 'feat/p1-run-complete-nonblocking')

    expect(subject).toBe('chore(merge): integrate approved branch changes')
    expect(subject).not.toContain('feat/p1-run-complete-nonblocking')
    expect(subject).not.toContain('run')
    expect(checkPublicGitMetadata(subject).ok).toBe(true)
  })

  it('emits a conventional PR-number fallback subject', () => {
    const subject = buildMergeSubject(runId, undefined, 42)

    expect(subject).toBe('chore(merge): integrate approved pull request')
    expect(subject).not.toContain('42')
    expect(subject).not.toContain(runId.slice(0, 8))
    expect(checkPublicGitMetadata(subject).ok).toBe(true)
  })

  it('emits a conventional branchless fallback subject', () => {
    const subject = buildMergeSubject(runId)

    expect(subject).toBe('chore(merge): integrate approved changes')
    expect(subject).not.toContain(runId.slice(0, 8))
    expect(checkPublicGitMetadata(subject).ok).toBe(true)
  })
})
