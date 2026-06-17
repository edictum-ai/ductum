import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FactorySecretResolver } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let dirs: string[] = []

afterEach(async () => {
  fixture?.close()
  fixture = undefined
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('Factory Settings encrypted secrets P5', () => {
  it('creates, rotates, tests, lists, and deletes write-only encrypted secrets', async () => {
    const factoryDir = await factoryDirWithKey()
    let now = new Date('2026-06-11T00:00:00.000Z')
    fixture = await createFixture({ factoryDataDir: factoryDir, now: () => now })
    seedBase(fixture)
    const plaintext = 'plain-secret-value'

    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'openai-api-key', value: plaintext },
    })

    expect(created.response.status).toBe(201)
    expectPublicSecret(created.text, plaintext)
    expect(created.json).toMatchObject({
      name: 'openai-api-key',
      scope: 'factory',
      status: 'configured',
      lastRotatedAt: '2026-06-11T00:00:00.000Z',
      lastTestedAt: null,
    })
    expect(Object.keys((created.json as Record<string, unknown>) ?? {}).sort()).toEqual(metadataKeys())

    const id = (created.json as { id: string }).id
    const stored = fixture.repos.secrets.get(id)
    expect(stored?.payload.algorithm).toBe('aes-256-gcm')
    expect(stored?.payload.ciphertext).not.toContain(plaintext)
    expect(stored?.payload.authTag).toEqual(expect.any(String))
    expect(stored?.keySource.keyId).toMatch(/^local:/)

    const list = await requestJson(fixture.app, '/api/factory/secrets')
    const detail = await requestJson(fixture.app, `/api/factory/secrets/${id}`)
    expect(list.response.status).toBe(200)
    expect(detail.response.status).toBe(200)
    expectPublicSecret(list.text, plaintext, stored?.payload.ciphertext, stored?.keySource.keyId)
    expectPublicSecret(detail.text, plaintext, stored?.payload.ciphertext, stored?.keySource.keyId)

    now = new Date('2026-06-11T00:05:00.000Z')
    const tested = await requestJson(fixture.app, `/api/factory/secrets/${id}/test`, { method: 'POST' })
    expect(tested.response.status).toBe(200)
    expectPublicSecret(tested.text, plaintext, stored?.payload.ciphertext, stored?.keySource.keyId)
    expect(tested.json).toMatchObject({ id, lastTestedAt: '2026-06-11T00:05:00.000Z' })

    now = new Date('2026-06-11T00:10:00.000Z')
    const oldCiphertext = fixture.repos.secrets.get(id)?.payload.ciphertext
    const rotated = await requestJson(fixture.app, `/api/factory/secrets/${id}`, {
      method: 'PATCH',
      body: { value: plaintext, name: 'openai-api-key-rotated', description: 'rotated' },
    })
    expect(rotated.response.status).toBe(200)
    const nextStored = fixture.repos.secrets.get(id)
    expect(nextStored?.payload.ciphertext).not.toBe(oldCiphertext)
    expect(nextStored?.description).toBe('rotated')
    expect(new FactorySecretResolver({ factoryDir, secrets: fixture.repos.secrets }).resolve(`secret:${id}`))
      .toBe(plaintext)
    expectPublicSecret(rotated.text, plaintext, nextStored?.payload.ciphertext, nextStored?.keySource.keyId)

    const deleted = await requestJson(fixture.app, `/api/factory/secrets/${id}`, { method: 'DELETE' })
    expect(deleted.response.status).toBe(204)
    expect(() => new FactorySecretResolver({ factoryDir, secrets: fixture!.repos.secrets }).resolve(`secret:${id}`))
      .toThrow(/Secret not found/)
  })

  it('fails closed when the local key file is missing, wrong-sized, or unsafe', async () => {
    const missing = await tempFactoryDir()
    const missingResult = await createSecretWithFactoryDir(missing, 'missing-secret-value')
    expect(missingResult.response.status).toBe(500)
    expect(missingResult.text).not.toContain('missing-secret-value')
    expect(missingResult.json).toMatchObject({ error: expect.stringContaining('missing') })

    const wrongSize = await tempFactoryDir()
    await writeKey(wrongSize, randomBytes(16), 0o600)
    const wrongSizeResult = await createSecretWithFactoryDir(wrongSize, 'wrong-size-secret-value')
    expect(wrongSizeResult.response.status).toBe(500)
    expect(wrongSizeResult.text).not.toContain('wrong-size-secret-value')
    expect(wrongSizeResult.json).toMatchObject({ error: expect.stringContaining('exactly 32 bytes') })

    if (process.platform !== 'win32') {
      const unsafe = await tempFactoryDir()
      await writeKey(unsafe, randomBytes(32), 0o644)
      const unsafeResult = await createSecretWithFactoryDir(unsafe, 'unsafe-secret-value')
      expect(unsafeResult.response.status).toBe(500)
      expect(unsafeResult.text).not.toContain('unsafe-secret-value')
      expect(unsafeResult.json).toMatchObject({ error: expect.stringContaining('0600') })
    }
  })
})

async function createSecretWithFactoryDir(factoryDir: string, value: string) {
  const testFixture = await createFixture({ factoryDataDir: factoryDir })
  try {
    seedBase(testFixture)
    return await requestJson(testFixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'api-key', value },
    })
  } finally {
    testFixture.close()
  }
}

function expectPublicSecret(text: string, ...secretValues: Array<string | undefined>): void {
  for (const value of secretValues) {
    if (value != null) expect(text).not.toContain(value)
  }
  for (const key of ['value', 'payload', 'ciphertext', 'nonce', 'authTag', 'keyId', 'keySource']) {
    expect(text).not.toContain(key)
  }
}

function metadataKeys(): string[] {
  return ['createdAt', 'id', 'lastRotatedAt', 'lastTestedAt', 'name', 'scope', 'status', 'updatedAt']
}

async function factoryDirWithKey(): Promise<string> {
  const dir = await tempFactoryDir()
  await writeKey(dir, randomBytes(32), 0o600)
  return dir
}

async function tempFactoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-api-secrets-'))
  dirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  return dir
}

async function writeKey(factoryDir: string, key: Buffer, mode: number): Promise<void> {
  const keyPath = join(factoryDir, '.ductum', 'secrets.key')
  await writeFile(keyPath, key, { mode })
  await chmod(keyPath, mode)
}
