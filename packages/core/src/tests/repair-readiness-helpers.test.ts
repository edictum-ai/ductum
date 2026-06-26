import { describe, expect, it } from 'vitest'

import { createId, type Agent, type ConfigResourceId, type ProjectId } from '../types.js'
import type { ConfigResource } from '../resource-types.js'
import { findResource, providerForAgent } from '../repair-readiness-helpers.js'

describe('repair readiness helpers', () => {
  it('resolves named resources in project scope before factory globals', () => {
    const projectId = createId<'ProjectId'>() as ProjectId
    const otherProjectId = createId<'ProjectId'>() as ProjectId
    const resources = [
      modelResource('other', 'shared-model', otherProjectId, 'anthropic'),
      modelResource('global', 'shared-model', null, 'zai'),
      modelResource('project', 'shared-model', projectId, 'openai'),
    ]

    expect(findResource(resources, 'shared-model', projectId)?.id).toBe('project')
    expect(findResource(resources, 'shared-model', null)?.id).toBe('global')
  })

  it('uses legacy providerId when no saved model resolves', () => {
    expect(providerForAgent(agent({ providerId: 'openai', model: 'unknown-model' }), [])).toBe('openai')
  })
})

function modelResource(id: string, name: string, projectId: ProjectId | null, provider: string): ConfigResource {
  return {
    id: id as ConfigResourceId,
    kind: 'Model',
    projectId,
    name,
    spec: { provider, modelId: name },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: createId(),
    name: 'agent',
    model: 'gpt-5.4',
    harness: 'codex-sdk',
    resourceRefs: {},
    capabilities: [],
    effort: null,
    costTier: 0,
    spawnConfig: {},
    ...overrides,
  } as Agent
}
