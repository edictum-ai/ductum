import type { Agent } from '@ductum/core'

import type { ApiContext } from './deps.js'

export function ensureRecordedAuthorAgent(context: ApiContext, author: string): Agent {
  const name = author.trim()
  const existing = context.repos.agents.get(name as Agent['id']) ?? context.repos.agents.getByName(name)
  if (existing != null) return existing
  return context.repos.agents.create({
    id: name as Agent['id'],
    name,
    model: `recorded:${slugifyAuthor(name)}`,
    // Provenance-only placeholder: recorded agents never dispatch work.
    harness: 'codex-sdk',
    resourceRefs: {},
    capabilities: [],
    effort: null,
    costTier: 0,
    spawnConfig: {},
    pricing: null,
  })
}

function slugifyAuthor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'operator'
}
