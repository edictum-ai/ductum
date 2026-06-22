import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, vi, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - factory doctor', () => {
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
