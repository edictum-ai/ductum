import type { FactorySecretScope } from '@ductum/core'
import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, vi, type TestFixture } from './shared.js'

type DoctorResponse = {
  agents: Array<{ agentName: string; status: string; checks: unknown[] }>
  sharedReadiness?: { items?: Array<{ id: string }> }
}

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - factory doctor scoped provider auth', () => {
  it('accepts GLM/Z.AI auth from the agent spawn secret instead of global env', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_OAUTH_TOKEN', '')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('ZAI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-secret-do-not-print')

    fixture = await createFixture()
    const { builder } = seedBase(fixture)
    seedConfigResources(fixture)
    seedSecretMetadata(fixture, { id: 'zai-token', scope: 'factory', projectId: null })
    fixture.repos.agents.update(builder.id, {
      model: 'glm-5.2',
      harness: 'claude-agent-sdk',
      providerId: 'zai',
      resourceRefs: { modelRef: 'glm-5.2', harnessRef: 'claude-agent-sdk' },
      spawnConfig: {
        env: {
          ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
          ANTHROPIC_AUTH_TOKEN: 'secret:zai-token',
        },
      },
    })

    const response = await requestJson(fixture.app, '/api/factory/doctor')
    const body = response.json as DoctorResponse
    const glm = body.agents.find((agent) => agent.agentName === 'mimi')
    const itemIds = body.sharedReadiness?.items?.map((item) => item.id) ?? []

    expect(response.response.status).toBe(200)
    expect(glm).toMatchObject({ status: 'ready' })
    expect(glm?.checks).toContainEqual(expect.objectContaining({
      kind: 'auth',
      status: 'ready',
      refs: ['ANTHROPIC_AUTH_TOKEN'],
    }))
    expect(itemIds).not.toContain('provider:zai:auth:missing')
    expect(itemIds).not.toContain(`agent:${builder.id}:provider:zai:auth:missing`)
    expect(response.text).not.toContain('secret:zai-token')
    expect(response.text).not.toContain('sk-openai-secret-do-not-print')
  })
})

function seedConfigResources(target: TestFixture): void {
  target.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Model',
    projectId: null,
    name: 'glm-5.2',
    spec: { provider: 'zai', modelId: 'glm-5.2' },
  })
  target.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Model',
    projectId: null,
    name: 'gpt-5-4',
    spec: { provider: 'openai', modelId: 'gpt-5.4' },
  })
  target.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Harness',
    projectId: null,
    name: 'claude-agent-sdk',
    spec: { type: 'claude-agent-sdk', command: '/bin/echo' },
  })
  target.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Harness',
    projectId: null,
    name: 'codex-sdk',
    spec: { type: 'codex-sdk', command: '/bin/echo' },
  })
}

function seedSecretMetadata(
  target: TestFixture,
  options: { id: string; scope: FactorySecretScope; projectId: string | null },
): void {
  target.repos.secrets.create({
    id: options.id,
    name: options.id,
    scope: options.scope,
    projectId: options.projectId as never,
    description: null,
    status: 'configured',
    keySource: { type: 'local-file', keyId: 'local-key' },
    payload: { algorithm: 'aes-256-gcm', ciphertext: 'ciphertext', nonce: 'nonce', authTag: 'tag' },
    lastRotatedAt: null,
    lastTestedAt: null,
  })
}
