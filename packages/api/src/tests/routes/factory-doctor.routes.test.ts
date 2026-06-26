import { chmod, readFile } from 'node:fs/promises'

import type { RepairHostChecks } from '@ductum/core'
import { createFixture, createId, describe, expect, it, join, mkdtemp, registerRouteTestCleanup, requestJson, rm, seedBase, tmpdir, vi, writeFile, type TestFixture } from './shared.js'

type DoctorResponse = {
  agents: Array<{ agentName: string; status: string; checks: unknown[] }>
  sharedReadiness?: { items?: Array<{ id: string }> }
}

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - factory doctor', () => {
  it('accepts Codex local login status for OpenAI Codex agents without env credentials', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-'))
    const codexPath = join(binDir, 'codex')
    await writeFile(codexPath, [
      '#!/bin/sh',
      'if [ "$1" = "login" ] && [ "$2" = "status" ]; then',
      '  echo "Logged in using ChatGPT"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'))
    await chmod(codexPath, 0o755)
    vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-anthropic-secret-do-not-print')

    try {
      fixture = await createFixture()
      seedBase(fixture)
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'claude-opus-4-6', spec: { provider: 'anthropic', modelId: 'claude-opus-4.6' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: 'codex' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: '/bin/echo' } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({
        agentName: 'codex',
        status: 'ready',
      })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'ready',
        message: 'Codex login status is active',
        refs: ['codex'],
      }))
      expect(response.text).not.toContain('sk-anthropic-secret-do-not-print')
      expect(response.text).not.toContain('Logged in using ChatGPT')
      expect(response.text).not.toContain('OPENAI_API_KEY')
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('checks OpenAI Codex auth through the configured harness command', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'ductum-codex-custom-'))
    const codexPath = join(binDir, 'codex-beta')
    const logPath = join(binDir, 'codex-beta.log')
    await writeFile(codexPath, [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${logPath}"`,
      'if [ "$1" = "login" ] && [ "$2" = "status" ]; then',
      '  echo "Logged in through custom Codex"',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'))
    await chmod(codexPath, 0o755)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('PATH', process.env.PATH ?? '')

    try {
      fixture = await createFixture()
      seedBase(fixture)
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: codexPath } })

      const response = await requestJson(fixture.app, '/api/factory/doctor')
      const body = response.json as DoctorResponse
      const codex = body.agents.find((agent) => agent.agentName === 'codex')

      expect(response.response.status).toBe(200)
      expect(codex).toMatchObject({ agentName: 'codex', status: 'ready' })
      expect(codex?.checks).toContainEqual(expect.objectContaining({
        kind: 'auth',
        status: 'ready',
        message: 'Codex login status is active',
        refs: [codexPath],
      }))
      expect(body.sharedReadiness?.items?.map((item) => item.id)).not.toContain('provider:openai:auth:missing')
      expect(await readFile(logPath, 'utf-8')).toContain('login status')
      expect(response.text).not.toContain('Logged in through custom Codex')
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('marks requested live smoke deferred without spending tokens', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-secret-do-not-print')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'sk-anthropic-secret-do-not-print')
    fixture = await createFixture()
    seedBase(fixture)
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'gpt-5-4', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'claude-opus-4-6', spec: { provider: 'anthropic', modelId: 'claude-opus-4.6' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'codex-sdk', spec: { type: 'codex-sdk', command: '/bin/echo' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: '/bin/echo' } })

    const response = await requestJson(fixture.app, '/api/factory/doctor?liveSmoke=1')

    expect(response.response.status).toBe(200)
    expect(response.json).toMatchObject({
      liveSmoke: {
        enabled: true,
        status: 'deferred',
        reason: 'live smoke was requested but is deferred on this static API doctor; no token-spending request was sent',
      },
    })
    expect(response.text).not.toContain('sk-openai-secret-do-not-print')
    expect(response.text).not.toContain('sk-anthropic-secret-do-not-print')
  })

  it('reuses the repair readiness producer for shared prerequisite output', async () => {
    const secret = 'sk-openai-secret-do-not-print'
    const repairChecks: Partial<RepairHostChecks> = {
      git: { state: 'ready', label: 'Git is installed' },
      factoryDataDir: { state: 'ready', label: '/tmp/ductum' },
      providerAuth: {
        openai: { state: 'missing', label: secret, detail: `OpenAI auth missing for ${secret}` },
      },
      repositories: {},
    }
    fixture = await createFixture({
      repairChecks,
      probeLocalAppHealth: vi.fn().mockResolvedValue({
        state: 'missing',
        label: 'API reachable on 127.0.0.1:4100',
        detail: 'Local app health check timed out after 500ms.',
      }),
    })
    const { project } = seedBase(fixture)
    const repo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    repairChecks.repositories = {
      [repo.id]: {
        localGit: {
          state: 'missing',
          label: '/repo/ductum',
          detail: 'git -C /repo/ductum rev-parse --is-inside-work-tree failed',
        },
      },
    }

    const [doctor, repair] = await Promise.all([
      requestJson(fixture.app, '/api/factory/doctor'),
      requestJson(fixture.app, '/api/repair'),
    ])
    const doctorItems = ((doctor.json as { sharedReadiness?: { items?: Array<{ id: string; status: string; field: { value?: string }; reason: string }> } })
      .sharedReadiness?.items ?? [])
    const repairItems = (repair.json as { items: Array<{ id: string; status: string; field: { value?: string }; reason: string }> }).items

    expect(doctor.response.status).toBe(200)
    expect(doctorItems).toEqual(repairItems)
    expect(doctorItems).toContainEqual(expect.objectContaining({
      id: 'factory:local-app-port',
      status: 'missing',
      field: expect.objectContaining({ value: 'API reachable on 127.0.0.1:4100' }),
      reason: 'Local app health check timed out after 500ms.',
    }))
    expect(doctorItems).toContainEqual(expect.objectContaining({
      id: 'provider:openai:auth:missing',
      status: 'missing',
      reason: expect.stringContaining('[redacted]'),
    }))
    expect(doctor.text).not.toContain(secret)
    expect(repair.text).not.toContain(secret)
  })
})
