import { describe, expect, it } from 'vitest'

import { buildReviewPrompt } from '../post-completion.js'
import { createId, type Task } from '../types.js'

function makeOriginalTask(prompt: string): Task {
  return {
    id: createId<'TaskId'>(),
    specId: createId<'SpecId'>(),
    targetId: null,
    name: 'P1',
    prompt,
    repos: [],
    assignedAgentId: null,
    requiredRole: 'builder',
    complexity: 'simple',
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      kind: 'github-issue',
      provider: 'github',
      repoOwner: 'edictum-ai',
      repoName: 'ductum',
      issueNumber: 48,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/48',
      title: 'factory: import prompts from issue',
      labels: ['P1'],
      importedAt: '2026-06-25T00:00:00.000Z',
      promptImport: {
        mode: 'prompt-sections',
        promptDigest: 'digest-123',
        reviewPromptRoutedToTask: true,
        implementation: {
          heading: 'Implementation Prompt',
          body: prompt,
          digest: 'impl-123',
          sourceKind: 'issue-body',
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48',
        },
        review: {
          heading: 'Review Prompt',
          body: 'Return PASS/WARN/FAIL with provenance notes.',
          digest: 'review-123',
          sourceKind: 'issue-comment',
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
          commentUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
        },
      },
    },
  }
}

describe('buildReviewPrompt imported GitHub review prompts', () => {
  it('includes imported GitHub review prompt instructions only in review tasks', () => {
    const prompt = buildReviewPrompt(
      makeOriginalTask('implement the thing'),
      '(diff)',
      '(verify ok)',
      undefined,
      'Return PASS/WARN/FAIL with provenance notes.',
    )

    expect(prompt).toContain('### Imported Review Prompt')
    expect(prompt).toContain('Return PASS/WARN/FAIL with provenance notes.')
  })
})
