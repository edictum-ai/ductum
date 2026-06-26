import { createId, type RepairHostChecks } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('repair local app readiness', () => {
  it('surfaces a failing local app probe as an operator-visible repair item', async () => {
    const repairChecks: Partial<RepairHostChecks> = {
      git: { state: 'ready', label: 'Git is installed' },
      factoryDataDir: { state: 'ready', label: '/tmp/ductum' },
      providerAuth: {
        anthropic: { state: 'ready', label: 'Anthropic auth detected' },
        openai: { state: 'ready', label: 'OpenAI auth detected' },
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
        adapterCount: 2,
        adapters: ['claude-agent-sdk', 'codex-sdk'],
        reason: null,
      }),
      probeLocalAppHealth: vi.fn().mockResolvedValue({
        state: 'missing',
        label: 'API reachable on 127.0.0.1:4100',
        detail: 'Local app health check timed out after 500ms.',
      }),
    })
    const { project, builder, reviewer } = seedBase(fixture)
    repairChecks.providerAuthByAgent = readySeededAgentAuth(builder.id, reviewer.id)
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = { [repo.id]: { localGit: { state: 'ready', label: '/repo/ductum' } } }

    const result = await requestJson(fixture.app, '/api/repair')
    const body = result.json as { items: Array<{ id: string; status: string; field: { value: string }; reason: string }> }
    const item = body.items.find((entry) => entry.id === 'factory:local-app-port')

    expect(result.response.status).toBe(200)
    expect(item).toMatchObject({
      status: 'missing',
      field: { value: 'API reachable on 127.0.0.1:4100' },
      reason: 'Local app health check timed out after 500ms.',
    })
  })

  it('keeps repair clear when the local app probe succeeds', async () => {
    const repairChecks: Partial<RepairHostChecks> = {
      git: { state: 'ready', label: 'Git is installed' },
      factoryDataDir: { state: 'ready', label: '/tmp/ductum' },
      providerAuth: {
        anthropic: { state: 'ready', label: 'Anthropic auth detected' },
        openai: { state: 'ready', label: 'OpenAI auth detected' },
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
        adapterCount: 2,
        adapters: ['claude-agent-sdk', 'codex-sdk'],
        reason: null,
      }),
      probeLocalAppHealth: vi.fn().mockResolvedValue({
        state: 'ready',
        label: 'API reachable on 127.0.0.1:4100',
      }),
    })
    const { project, builder, reviewer } = seedBase(fixture)
    repairChecks.providerAuthByAgent = readySeededAgentAuth(builder.id, reviewer.id)
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = { [repo.id]: { localGit: { state: 'ready', label: '/repo/ductum' } } }

    const result = await requestJson(fixture.app, '/api/repair')
    const body = result.json as { items: Array<{ id: string }>; summary: { blockers: number } }

    expect(result.response.status).toBe(200)
    expect(body.items.some((item) => item.id === 'factory:local-app-port')).toBe(false)
    expect(body.summary.blockers).toBe(0)
  })
})

function readySeededAgentAuth(builderId: string, reviewerId: string): NonNullable<RepairHostChecks['providerAuthByAgent']> {
  return {
    [builderId]: { state: 'ready', label: 'Anthropic auth detected' },
    [reviewerId]: { state: 'ready', label: 'Codex login is active' },
  }
}
