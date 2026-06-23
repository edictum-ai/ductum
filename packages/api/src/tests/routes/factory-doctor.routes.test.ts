import { chmod } from 'node:fs/promises'

import { createFixture, createId, describe, expect, it, join, mkdtemp, registerRouteTestCleanup, requestJson, rm, seedBase, tmpdir, vi, writeFile, type TestFixture } from './shared.js'

type DoctorResponse = {
  agents: Array<{ agentName: string; status: string; checks: unknown[] }>
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
})
