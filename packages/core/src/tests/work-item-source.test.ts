import { describe, expect, it } from 'vitest'

import {
  normalizeWorkItemSource,
  parseWorkItemSource,
  serializeWorkItemSource,
} from '../work-item-source.js'

describe('work item source prompt imports', () => {
  it('round-trips GitHub prompt-section source metadata including provenance and digest', () => {
    const source = {
      kind: 'github-issue' as const,
      provider: 'github' as const,
      repoOwner: 'edictum-ai',
      repoName: 'ductum',
      issueNumber: 48,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/48',
      title: 'factory: import prompts from issue',
      labels: ['P1'],
      importedAt: '2026-06-25T00:00:00.000Z',
      promptImport: {
        mode: 'prompt-sections' as const,
        promptDigest: 'digest-123',
        reviewPromptRoutedToTask: true,
        implementation: {
          heading: 'Implementation Prompt' as const,
          body: 'Implement prompt intake.',
          digest: 'impl-123',
          sourceKind: 'issue-body' as const,
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48',
        },
        review: {
          heading: 'Review Prompt' as const,
          body: 'Review prompt intake.',
          digest: 'review-123',
          sourceKind: 'issue-comment' as const,
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
          commentUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
        },
      },
    }

    const serialized = serializeWorkItemSource(source)
    expect(parseWorkItemSource(serialized)).toEqual(source)
    expect(normalizeWorkItemSource(JSON.parse(serialized ?? 'null'))).toEqual(source)
  })

  it('rejects invalid prompt import metadata', () => {
    expect(normalizeWorkItemSource({
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
          heading: 'Not A Prompt',
          body: 'bad',
          digest: 'impl-123',
          sourceKind: 'issue-body',
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48',
        },
        review: {
          heading: 'Review Prompt',
          body: 'review',
          digest: 'review-123',
          sourceKind: 'issue-comment',
          sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
          commentUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1',
        },
      },
    })).toBeNull()
  })
})
