import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId, type RepairHostChecks } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.unstubAllEnvs()
  fixture?.close()
  fixture = undefined
})

describe('repair routes - Copilot auth', () => {
  it('does not block repair when GitHub Copilot auth is detected', async () => {
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'gho_secret-do-not-print')
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: {
        anthropic: ready('Anthropic auth detected'),
        openai: ready('OpenAI auth detected'),
      },
      repositories: {},
    }
    fixture = await createFixture({
      repairChecks,
      getDispatcherStatus: () => ({
        running: true,
        activeRuns: 0,
        maxConcurrentRuns: 3,
        lastCycleAt: '2026-06-09T12:00:00.000Z',
        enabled: true,
        adapterCount: 3,
        adapters: ['claude-agent-sdk', 'codex-sdk', 'copilot-sdk'],
        reason: null,
      }),
    })
    seedBase(fixture)
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'github-copilot-gpt-5', spec: { provider: 'github-copilot', modelId: 'github-copilot-gpt-5' } })
    fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'copilot-builder',
      model: 'github-copilot-gpt-5',
      harness: 'copilot-sdk',
      resourceRefs: { modelRef: 'github-copilot-gpt-5' },
      capabilities: ['build'],
      costTier: 20,
      spawnConfig: {},
    })

    const result = await requestJson(fixture.app, '/api/repair')
    const body = result.json as { items: Array<{ area: string; target: { providerId?: string } | null }> }

    expect(result.response.status).toBe(200)
    expect(body.items.some((item) => item.area === 'provider_auth' && item.target?.providerId === 'github-copilot'))
      .toBe(false)
    expect(result.text).not.toContain('gho_secret-do-not-print')
  })
})

function ready(label: string) {
  return { state: 'ready' as const, label }
}
