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
  it('keeps shared per-agent Codex readiness when provider-wide overrides are also present', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-shared-override-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, '#!/bin/sh\nexit 1\n')
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)

    const repairChecks: Partial<RepairHostChecks> = {
      providerAuth: {
        openai: { state: 'ready', label: 'OpenAI credential source detected' },
      },
    }
    try {
      fixture = await createFixture({ repairChecks })
      const { reviewer } = seedBase(fixture)
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({ agentName: 'codex', status: 'blocked' })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'blocked',
        refs: ['codex'],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id))
        .toContain(`agent:${reviewer.id}:provider:openai:auth:missing`)
      expect(body.sharedReadiness?.items?.map((item) => item.id))
        .not.toContain('provider:openai:auth:missing')
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('accepts OpenAI environment credentials without probing a failing Codex command', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-env-provider-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, '#!/bin/sh\nexit 1\n')
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)

    try {
      fixture = await createFixture()
      const { reviewer } = seedBase(fixture)
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({ agentName: 'codex', status: 'ready' })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'ready',
        message: 'provider credential env present for openai (OPENAI_API_KEY)',
        refs: ['OPENAI_API_KEY'],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id))
        .not.toContain(`agent:${reviewer.id}:provider:openai:auth:missing`)
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

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


  it('keeps legacy providerId Codex agents in shared readiness when no saved Model resolves', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-legacy-provider-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, '#!/bin/sh\nexit 1\n')
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)

    try {
      fixture = await createFixture()
      const { reviewer } = seedBase(fixture)
      fixture.repos.agents.update(reviewer.id, {
        model: 'legacy-openai-model',
        providerId: 'openai',
        resourceRefs: { harnessRef: 'codex-sdk' },
      })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'blocked',
        refs: ['codex'],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id))
        .toContain(`agent:${reviewer.id}:provider:openai:auth:missing`)
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('resolves shared auth providers through the same saved model fallback as doctor', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-model-fallback-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, '#!/bin/sh\nexit 1\n')
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-anthropic-secret-do-not-print')

    try {
      fixture = await createFixture()
      const { reviewer } = seedBase(fixture)
      fixture.repos.agents.update(reviewer.id, { model: 'custom-openai-alias' })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'custom-openai-alias', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'claude-opus-4-6', spec: { provider: 'anthropic', modelId: 'claude-opus-4.6' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: '/bin/echo' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({ agentName: 'codex', status: 'blocked' })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'blocked',
        refs: ['codex'],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id))
        .toContain(`agent:${reviewer.id}:provider:openai:auth:missing`)
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })
})
