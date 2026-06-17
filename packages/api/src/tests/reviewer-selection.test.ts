import { describe, expect, it } from 'vitest'

import type { Agent } from '@ductum/core'

import { reviewerModelKey, selectReviewerAgent } from '../lib/reviewer-selection.js'

describe('reviewer selection', () => {
  it('prefers Opus 4.8 reviewers using a different model from the builder', () => {
    const builder = agent('builder', 'gpt-5.5', 95)
    const cheapReviewer = agent('cheap-reviewer', 'glm-5.2', 30)
    const opusReviewer = agent('opus-reviewer', 'claude-opus-4-8', 92)

    expect(selectReviewerAgent({
      implementingAgent: builder,
      candidates: [cheapReviewer, opusReviewer],
    })?.id).toBe(opusReviewer.id)
  })

  it('rejects same-agent and same-model review candidates before cost sorting', () => {
    const builder = agent('builder', 'openai/gpt-5.5', 95, 'gpt-5.5')
    const sameModelReviewer = agent('same-model', 'gpt-5.5', 10)
    const differentModelReviewer = agent('different-model', 'glm-5.2', 80)

    expect(selectReviewerAgent({
      implementingAgent: builder,
      candidates: [builder, sameModelReviewer, differentModelReviewer],
    })?.id).toBe(differentModelReviewer.id)
  })

  it('normalizes registry aliases when checking same-model review candidates', () => {
    const builder = agent('builder', 'anthropic.claude-opus-4-8', 95)
    const sameModelReviewer = agent('same-model', 'claude-opus-4-8', 10)

    expect(reviewerModelKey(builder)).toBe('claude-opus-4-8')
    expect(selectReviewerAgent({
      implementingAgent: builder,
      candidates: [sameModelReviewer],
    })).toBeNull()
  })
})

function agent(id: string, model: string, costTier: number, modelRef?: string): Agent {
  return {
    id: id as Agent['id'],
    name: id,
    model,
    harness: 'codex-sdk',
    resourceRefs: modelRef == null ? undefined : { modelRef },
    capabilities: ['build', 'test', 'fix', 'review'],
    effort: 'medium',
    costTier,
    spawnConfig: {},
    createdAt: '2026-06-13T00:00:00.000Z',
  }
}
