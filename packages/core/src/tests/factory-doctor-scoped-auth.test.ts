import { describe, expect, it } from 'vitest'

import {
  buildFactoryDoctorReport,
  buildFactorySettingsCatalogs,
  type Agent,
  type ConfigResource,
  type FactorySecretMetadata,
  type ProjectAgent,
} from '../index.js'

const now = '2026-06-28T00:00:00.000Z'

describe('factory doctor scoped provider auth', () => {
  it('accepts GLM/Z.AI auth from agent spawn env without global provider env', () => {
    const report = buildFactoryDoctorReport({
      catalogs: buildFactorySettingsCatalogs({ configResources: resources(), agents: [] }),
      agents: [agent({
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'secret:zai-token',
      })],
      assignments: [assignment('agent-glm')],
      secrets: [secret('zai-token')],
      env: {},
    })

    expect(report.status).toBe('ready')
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'auth',
      status: 'ready',
      message: 'provider credential agent spawn env present for zai (ANTHROPIC_AUTH_TOKEN)',
      refs: ['ANTHROPIC_AUTH_TOKEN'],
    }))
    expect(report.agents[0]?.checks).toContainEqual(expect.objectContaining({
      kind: 'endpoint',
      status: 'ready',
      refs: ['ANTHROPIC_BASE_URL'],
    }))
    expect(JSON.stringify(report)).not.toContain('secret:zai-token')
  })
})

function resources(): ConfigResource[] {
  return [
    resource('Model', 'glm-5.2', { provider: 'zai', modelId: 'glm-5.2' }),
    resource('Harness', 'claude-agent-sdk', { type: 'claude-agent-sdk', command: '/bin/echo' }),
  ]
}

function resource(kind: ConfigResource['kind'], name: string, spec: ConfigResource['spec']): ConfigResource {
  return { id: `${kind}-${name}` as ConfigResource['id'], kind, projectId: null, name, spec, createdAt: now, updatedAt: now }
}

function agent(env: Record<string, string>): Agent {
  return {
    id: 'agent-glm' as Agent['id'],
    name: 'glm',
    model: 'glm-5.2',
    harness: 'claude-agent-sdk',
    resourceRefs: { modelRef: 'glm-5.2', harnessRef: 'claude-agent-sdk' },
    capabilities: ['build'],
    effort: 'high',
    costTier: 50,
    spawnConfig: { env },
    createdAt: now,
  }
}

function assignment(agentId: string): ProjectAgent {
  return { projectId: 'project-1' as ProjectAgent['projectId'], agentId: agentId as ProjectAgent['agentId'], role: 'builder' }
}

function secret(id: string): FactorySecretMetadata {
  return {
    id,
    name: id,
    scope: 'factory',
    status: 'configured',
    createdAt: now,
    updatedAt: now,
    lastRotatedAt: now,
    lastTestedAt: null,
  }
}
