import { chmod, rm, writeFile } from 'node:fs/promises'

import type { RepairHostChecks } from '@ductum/core'
import { createFixture, createId, describe, expect, it, join, mkdtemp, registerRouteTestCleanup, requestJson, seedBase, tmpdir, vi, type TestFixture } from './shared.js'

type DoctorResponse = {
  agents: Array<{ agentName: string; status: string; checks: unknown[] }>
  sharedReadiness?: { items?: Array<{ id: string }> }
}

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - factory doctor shared auth', () => {
  it('uses shared Codex auth readiness for doctor agent auth checks', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-shared-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, '#!/bin/sh\nexit 1\n')
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-anthropic-secret-do-not-print')

    const repairChecks: Partial<RepairHostChecks> = {
      providerAuthByAgent: {},
    }
    try {
      fixture = await createFixture({ repairChecks })
      const { reviewer } = seedBase(fixture)
      repairChecks.providerAuthByAgent = {
        [reviewer.id]: { state: 'ready', label: 'Codex login is active' },
      }
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'claude-opus-4-6', spec: { provider: 'anthropic', modelId: 'claude-opus-4.6' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: '/bin/echo' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({ agentName: 'codex', status: 'ready' })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'ready',
        message: 'Codex login status is active',
        refs: ['codex'],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id)).not.toContain(`agent:${reviewer.id}:provider:openai:auth:missing`)
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })
})
