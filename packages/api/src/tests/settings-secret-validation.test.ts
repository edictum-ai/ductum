import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('config-resource literal secret validation', () => {
  it.each([
    ['Model', { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'sk-proj-test-secret' }, 'spec.accessRef'],
    ['Harness', { type: 'codex-sdk', requiredSecretRefs: ['sk-proj-test-secret'] }, 'spec.requiredSecretRefs.0'],
    ['SandboxProfile', { provider: 'host', mode: 'worktree', credentials: { value: 'plain-secret-value' } }, 'spec.credentials.value'],
    ['NotificationChannel', { backend: 'telegram', config: { webhookSecret: 'webhook-secret-value' } }, 'spec.config.webhookSecret'],
  ])('rejects resource literal secret for %s', async (kind, spec, field) => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, `/api/resources/${kind}`, {
      method: 'POST',
      body: { name: 'unsafe', spec },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toContain(field)
    expect((result.json as { error: string }).error).toContain('${ENV_VAR}')
    expect((result.json as { error: string }).error).toContain('literal secrets are not stored')
  })

  it('accepts an env reference for a model accessRef', async () => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/Model', {
      method: 'POST',
      body: { name: 'gpt', spec: { provider: 'openai', modelId: 'gpt-5.4', accessRef: '${OPENAI_API_KEY}' } },
    })

    expect(result.response.status).toBe(201)
  })

  it('rejects literal secrets when updating a config resource', async () => {
    fixture = await createFixture()
    const created = await requestJson(fixture.app, '/api/resources/Model', {
      method: 'POST',
      body: { name: 'gpt', spec: { provider: 'openai', modelId: 'gpt-5.4' } },
    })

    const updated = await requestJson(fixture.app, `/api/resources/Model/${(created.json as { id: string }).id}`, {
      method: 'PUT',
      body: { spec: { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'sk-proj-test-secret' } },
    })

    expect(updated.response.status).toBe(400)
    expect((updated.json as { error: string }).error).toContain('spec.accessRef')
  })

  it('accepts Ductum secret refs without resolving them in public routes', async () => {
    fixture = await createFixture()
    seedSecretMetadata(fixture, 'openai-api-key')
    seedSecretMetadata(fixture, 'telegram-webhook')

    const model = await requestJson(fixture.app, '/api/resources/Model', {
      method: 'POST',
      body: { name: 'gpt', spec: { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'secret:openai-api-key' } },
    })
    const channel = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: { backend: 'telegram', config: { webhookSecretRef: 'secret:telegram-webhook' } },
      },
    })
    const harness = await requestJson(fixture.app, '/api/resources/Harness', {
      method: 'POST',
      body: { name: 'codex', spec: { type: 'codex-sdk', requiredSecretRefs: ['secret:openai-api-key'] } },
    })

    expect(model.response.status).toBe(201)
    expect(channel.response.status).toBe(201)
    expect(harness.response.status).toBe(201)
    expect(model.text).toContain('secret:openai-api-key')
    expect(channel.text).toContain('secret:telegram-webhook')
    expect(harness.text).toContain('secret:openai-api-key')
  })

  it('rejects unknown Ductum secret refs before saving settings', async () => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/Model', {
      method: 'POST',
      body: { name: 'gpt', spec: { provider: 'openai', modelId: 'gpt-5.4', accessRef: 'secret:missing-key' } },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toContain('spec.accessRef')
    expect((result.json as { error: string }).error).toContain('unknown secret')

    const harness = await requestJson(fixture.app, '/api/resources/Harness', {
      method: 'POST',
      body: { name: 'codex', spec: { type: 'codex-sdk', requiredSecretRefs: ['secret:missing-key'] } },
    })
    expect(harness.response.status).toBe(400)
    expect((harness.json as { error: string }).error).toContain('spec.requiredSecretRefs.0')
    expect((harness.json as { error: string }).error).toContain('unknown secret')
  })

  it('rejects literal secrets in Agent spawn config while accepting secret refs', async () => {
    fixture = await createFixture()
    seedSecretMetadata(fixture, 'openai-api-key')

    const rejected = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'unsafe',
        model: 'gpt-5.4',
        harness: 'codex-sdk',
        spawnConfig: { env: { OPENAI_API_KEY: 'sk-proj-test-secret' } },
      },
    })
    expect(rejected.response.status).toBe(400)
    expect((rejected.json as { error: string }).error).toContain('spawnConfig.env.OPENAI_API_KEY')
    expect(rejected.text).not.toContain('sk-proj-test-secret')

    const accepted = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'safe',
        model: 'gpt-5.4',
        harness: 'codex-sdk',
        spawnConfig: { env: { OPENAI_API_KEY: 'secret:openai-api-key', CI: '1' } },
      },
    })
    expect(accepted.response.status).toBe(201)
    expect(accepted.text).toContain('secret:openai-api-key')
  })

  it('rejects literal secrets in Agent spawn config updates', async () => {
    fixture = await createFixture()

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'safe',
        model: 'gpt-5.4',
        harness: 'codex-sdk',
        spawnConfig: { env: { CI: '1' } },
      },
    })

    const updated = await requestJson(fixture.app, `/api/agents/${(created.json as { id: string }).id}`, {
      method: 'PUT',
      body: { spawnConfig: { env: { OPENAI_API_KEY: 'sk-proj-test-secret' } } },
    })

    expect(updated.response.status).toBe(400)
    expect((updated.json as { error: string }).error).toContain('spawnConfig.env.OPENAI_API_KEY')
    expect(updated.text).not.toContain('sk-proj-test-secret')
  })
})

function seedSecretMetadata(testFixture: TestFixture, id: string): void {
  testFixture.repos.secrets.create({
    id,
    name: id,
    scope: 'factory',
    projectId: null,
    description: null,
    status: 'configured',
    keySource: { type: 'local-file', keyId: 'local-key' },
    payload: { algorithm: 'aes-256-gcm', ciphertext: 'ciphertext', nonce: 'nonce', authTag: 'tag' },
    lastRotatedAt: null,
    lastTestedAt: null,
  })
}
