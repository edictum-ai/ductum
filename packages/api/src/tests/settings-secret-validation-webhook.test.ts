import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('NotificationChannel webhook config validation', () => {
  it('rejects unknown fields on webhook channel config', async () => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: {
          backend: 'webhook',
          config: {
            url: 'https://example.test/hook',
            secret: '${WEBHOOK_SECRET}',
            events: ['approval.requested'],
          },
        },
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toContain('spec.config.events')
    expect((result.json as { error: string }).error).toContain('not supported for webhook')
  })

  it('requires url and secret when webhook channel is enabled', async () => {
    fixture = await createFixture()

    const missingUrl = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: { name: 'ops', spec: { backend: 'webhook', config: { secret: '${WEBHOOK_SECRET}' } } },
    })
    expect(missingUrl.response.status).toBe(400)
    expect((missingUrl.json as { error: string }).error).toContain('spec.config.url is required')

    const missingSecret = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: { name: 'ops', spec: { backend: 'webhook', config: { url: 'https://example.test/hook' } } },
    })
    expect(missingSecret.response.status).toBe(400)
    expect((missingSecret.json as { error: string }).error).toContain('spec.config.secret is required')

    const valid = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: { backend: 'webhook', config: { url: 'https://example.test/hook', secret: '${WEBHOOK_SECRET}' } },
      },
    })
    expect(valid.response.status).toBe(201)
  })

  it.each([
    ['http://example.test/hook', 'https:'],
    ['ftp://example.test/hook', 'https:'],
    ['not a url', 'absolute HTTPS URL'],
    ['https://localhost/hook', 'localhost'],
    ['https://127.0.0.1/hook', 'loopback'],
    ['https://0.0.0.0/hook', 'loopback'],
    ['https://[::1]/hook', 'loopback'],
    ['https://10.1.2.3/hook', 'RFC1918'],
    ['https://192.168.1.1/hook', 'RFC1918'],
    ['https://172.16.5.5/hook', 'RFC1918'],
    ['https://169.254.169.254/hook', 'link-local'],
    ['https://user:pass@example.test/hook', 'credentials'],
  ])('rejects webhook URL %s', async (url, expected) => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: { backend: 'webhook', config: { url, secret: '${WEBHOOK_SECRET}' } },
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toContain('spec.config.url')
    expect((result.json as { error: string }).error).toContain(expected)
  })

  it('rejects literal webhook secrets and accepts references', async () => {
    fixture = await createFixture()
    seedSecretMetadata(fixture, 'webhook-secret')

    const literal = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops',
        spec: {
          backend: 'webhook',
          config: { url: 'https://example.test/hook', secret: 'plain-secret-value' },
        },
      },
    })
    expect(literal.response.status).toBe(400)
    expect((literal.json as { error: string }).error).toContain('spec.config.secret')
    expect(literal.text).not.toContain('plain-secret-value')

    const envRef = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops-env',
        spec: {
          backend: 'webhook',
          config: { url: 'https://example.test/hook', secret: '${WEBHOOK_SECRET}' },
        },
      },
    })
    expect(envRef.response.status).toBe(201)

    const ductumRef = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: {
        name: 'ops-ductum',
        spec: {
          backend: 'webhook',
          config: { url: 'https://example.test/hook', secret: 'secret:webhook-secret' },
        },
      },
    })
    expect(ductumRef.response.status).toBe(201)
    expect(ductumRef.text).toContain('secret:webhook-secret')
  })

  it('allows disabled webhook channels to omit url and secret', async () => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/NotificationChannel', {
      method: 'POST',
      body: { name: 'ops', spec: { backend: 'webhook', config: { enabled: false } } },
    })

    expect(result.response.status).toBe(201)
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
