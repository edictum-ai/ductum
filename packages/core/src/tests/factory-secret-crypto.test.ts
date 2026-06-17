import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  encryptFactorySecret,
  FactorySecretResolver,
  loadFactorySecretKey,
  SqliteFactorySecretRepo,
} from '../index.js'
import { createRepoContext } from './helpers.js'

let dirs: string[] = []
let context: ReturnType<typeof createRepoContext> | undefined

afterEach(async () => {
  context?.db.close()
  context = undefined
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('factory secret crypto', () => {
  it('stores encrypted payloads, rotates nonce-backed ciphertext, and resolves only until delete', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const repo = new SqliteFactorySecretRepo(context.db)
    const plaintext = 'plain-secret-value'
    const first = encryptFactorySecret(plaintext, loadFactorySecretKey(factoryDir))

    repo.create({
      id: 'secret-1',
      name: 'openai-api-key',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: first.keySource,
      payload: first.payload,
      lastRotatedAt: '2026-06-11T00:00:00.000Z',
      lastTestedAt: null,
    })

    expect(first.payload.ciphertext).not.toContain(plaintext)
    expect(repo.get('secret-1')?.payload.ciphertext).toBe(first.payload.ciphertext)
    const resolver = new FactorySecretResolver({ factoryDir, secrets: repo })
    expect(resolver.resolve('secret:secret-1')).toBe(plaintext)

    const second = encryptFactorySecret(plaintext, loadFactorySecretKey(factoryDir))
    expect(second.payload.ciphertext).not.toBe(first.payload.ciphertext)
    repo.update('secret-1', {
      keySource: second.keySource,
      payload: second.payload,
      lastRotatedAt: '2026-06-11T01:00:00.000Z',
    })
    expect(resolver.resolve('secret:secret-1')).toBe(plaintext)

    repo.delete('secret-1')
    expect(() => resolver.resolve('secret:secret-1')).toThrow(/Secret not found/)
  })

  it('fails closed for missing, wrong-size, unsafe, or symlinked key files', async () => {
    const missingDir = await tempFactoryDir()
    expect(() => loadFactorySecretKey(missingDir)).toThrow(/missing/)

    const wrongSizeDir = await tempFactoryDir()
    await writeKey(wrongSizeDir, randomBytes(16), 0o600)
    expect(() => loadFactorySecretKey(wrongSizeDir)).toThrow(/exactly 32 bytes/)

    const unsafeDir = await tempFactoryDir()
    await writeKey(unsafeDir, randomBytes(32), 0o644)
    if (process.platform !== 'win32') {
      expect(() => loadFactorySecretKey(unsafeDir)).toThrow(/0600/)
    }

    const targetDir = await factoryDirWithKey()
    const symlinkDir = await tempFactoryDir()
    await symlink(join(targetDir, '.ductum', 'secrets.key'), join(symlinkDir, '.ductum', 'secrets.key'))
    expect(() => loadFactorySecretKey(symlinkDir)).toThrow(/regular file/)
  })
})

async function factoryDirWithKey(): Promise<string> {
  const dir = await tempFactoryDir()
  await writeKey(dir, randomBytes(32), 0o600)
  return dir
}

async function tempFactoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-secrets-'))
  dirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  return dir
}

async function writeKey(factoryDir: string, key: Buffer, mode: number): Promise<void> {
  const keyPath = join(factoryDir, '.ductum', 'secrets.key')
  await writeFile(keyPath, key, { mode })
  await chmod(keyPath, mode)
}
