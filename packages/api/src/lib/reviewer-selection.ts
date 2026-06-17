import { resolveModelEntry, type Agent } from '@ductum/core'

export function selectReviewerAgent(input: {
  implementingAgent: Agent | null | undefined
  candidates: Agent[]
}): Agent | null {
  const implementingModel = reviewerModelKey(input.implementingAgent)
  const reviewers = input.candidates
    .filter((agent) => agent.id !== input.implementingAgent?.id)
    .filter((agent) => reviewerModelKey(agent) !== implementingModel)

  reviewers.sort((a, b) => reviewerPreference(a) - reviewerPreference(b) || a.costTier - b.costTier)
  return reviewers[0] ?? null
}

export function reviewerModelKey(agent: Agent | null | undefined): string | null {
  const raw = agent?.resourceRefs?.modelRef ?? agent?.model
  if (raw == null || raw === '') return null
  return resolveModelEntry(raw)?.id ?? raw.toLowerCase().replace(/^openai\//, '').replace(/^anthropic[./-]/, '')
}

function reviewerPreference(agent: Agent): number {
  return reviewerModelKey(agent) === 'claude-opus-4-8' ? 0 : 1
}
