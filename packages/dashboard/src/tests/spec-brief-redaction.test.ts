import { describe, expect, it } from 'vitest'

import type { Spec } from '@/api/client'
import { displaySpecName } from '@/lib/project-display'
import { buildSpecBrief } from '@/lib/spec-brief'

const now = '2026-06-15T12:00:00.000Z'

function spec(overrides: Partial<Spec> = {}): Spec {
  return {
    id: 'spec-partial-redacted-123456',
    projectId: 'project1',
    name: 'fix(provider-auth): [redacted]',
    status: 'done',
    document: 'Objective: Make the shared [redacted] validator a stated architectural rule.',
    createdAt: now,
    updatedAt: now,
    source: {
      kind: 'github-issue',
      provider: 'github',
      repoOwner: 'edictum-ai',
      repoName: 'ductum',
      issueNumber: 125,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/125',
      title: 'fix(provider-auth): [redacted]',
      labels: ['auth'],
      importedAt: now,
      formId: 'ductum-work-item',
      parsed: {
        workType: 'fix',
        priority: 'P1',
        area: 'auth',
        blockers: [],
        objective: 'Make the shared [redacted] validator a stated architectural rule.',
        evidence: [],
        requirements: ['Keep [redacted] out of dashboard summaries.'],
        outOfScope: [],
        acceptanceCriteria: [],
        verificationCommands: [],
        safetyNotes: [],
      },
    },
    ...overrides,
  }
}

describe('spec redaction display fallbacks', () => {
  it('does not promote partially redacted labels or summaries', () => {
    const item = spec()
    const brief = buildSpecBrief({ spec: item, projectName: 'ductum' })

    expect(displaySpecName(item)).toBe('edictum-ai/ductum#125')
    expect(brief.summary).toBe('Objective missing. Open the source spec before dispatching or approving this work.')
    expect(brief.highlights).toEqual([])
  })

  it('labels source-only URL documents as source of truth', () => {
    const brief = buildSpecBrief({
      spec: spec({
        name: '[redacted]',
        document: 'https://github.com/acartag7/ductum/issues/10',
        source: null,
      }),
      projectName: 'ductum',
    })

    expect(brief.summary).toBe('Source of truth: https://github.com/acartag7/ductum/issues/10')
  })
})
