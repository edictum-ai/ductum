import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  encryptFactorySecret,
  FactorySecretResolver,
  loadFactorySecretKey,
  SqliteFactorySecretRepo,
  SqliteFactorySecretAccessLogRepo,
  type FactorySecretAccessEventInput,
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

describe('FactorySecretResolver access log (P1 / issue #210)', () => {
  it('records a success event with threaded run/agent context when a secret resolves', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const secrets = new SqliteFactorySecretRepo(context.db)
    const accessLog = new SqliteFactorySecretAccessLogRepo(context.db)
    const plaintext = 'plain-secret-value'
    const encrypted = encryptFactorySecret(plaintext, loadFactorySecretKey(factoryDir))
    secrets.create({
      id: 'secret-1',
      name: 'openai-api-key',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: encrypted.keySource,
      payload: encrypted.payload,
      lastRotatedAt: '2026-07-01T00:00:00.000Z',
      lastTestedAt: null,
    })

    const now = new Date('2026-07-01T12:00:00.000Z')
    const resolver = new FactorySecretResolver({
      factoryDir,
      secrets,
      accessLog,
      now: () => now,
    })

    expect(resolver.resolve('secret:secret-1', { runId: 'run-1' as never, agentId: 'agent-1' as never }))
      .toBe(plaintext)

    const bySecret = accessLog.listBySecret('secret-1')
    expect(bySecret).toHaveLength(1)
    expect(bySecret[0]).toMatchObject({
      secretId: 'secret-1',
      runId: 'run-1',
      agentId: 'agent-1',
      outcome: 'success',
      errorMessage: null,
      attemptedAt: '2026-07-01T12:00:00.000Z',
    })
    // Run-scoped read returns the same event.
    expect(accessLog.listByRun('run-1' as never)).toEqual(bySecret)
    // No plaintext or encrypted material leaks into the persisted event.
    expect(JSON.stringify(bySecret[0])).not.toContain(plaintext)
    expect(JSON.stringify(bySecret[0])).not.toContain(encrypted.payload.ciphertext)
  })

  it('records a failure event (no value leakage) when the secret ref has no stored payload', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const secrets = new SqliteFactorySecretRepo(context.db)
    const accessLog = new SqliteFactorySecretAccessLogRepo(context.db)

    const now = new Date('2026-07-01T12:00:00.000Z')
    const resolver = new FactorySecretResolver({
      factoryDir,
      secrets,
      accessLog,
      now: () => now,
    })

    expect(() => resolver.resolve('secret:missing', { runId: 'run-2' as never })).toThrow(/Secret not found/)

    const events = accessLog.listBySecret('missing')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      secretId: 'missing',
      runId: 'run-2',
      agentId: null,
      outcome: 'failure',
      errorMessage: expect.stringContaining('Secret not found'),
    })
    // The error message echoes the ref identifier (good for ops triage) but
    // never carries plaintext or encrypted material — there is no value to
    // leak for a missing secret, and decrypt errors never echo ciphertext.
    expect(JSON.stringify(events[0])).not.toContain('payload')
    expect(JSON.stringify(events[0])).not.toContain('ciphertext')
  })

  it('records a failure event for malformed refs and still throws', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const secrets = new SqliteFactorySecretRepo(context.db)
    const accessLog = new SqliteFactorySecretAccessLogRepo(context.db)
    const resolver = new FactorySecretResolver({
      factoryDir,
      secrets,
      accessLog,
      now: () => new Date('2026-07-01T12:00:00.000Z'),
    })

    expect(() => resolver.resolve('not-a-ref', { runId: 'run-malformed' as never })).toThrow(/secret:<id>/)

    expect(accessLog.listBySecret('not-a-ref')).toEqual([])
    expect(accessLog.listByRun('run-malformed' as never)).toMatchObject([
      {
        secretId: null,
        runId: 'run-malformed',
        agentId: null,
        outcome: 'failure',
        errorMessage: expect.stringContaining('secret:<id>'),
      },
    ])
  })

  it('records operator-style resolutions with null run/agent context when no context is supplied', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const secrets = new SqliteFactorySecretRepo(context.db)
    const accessLog = new SqliteFactorySecretAccessLogRepo(context.db)
    const encrypted = encryptFactorySecret('val', loadFactorySecretKey(factoryDir))
    secrets.create({
      id: 'secret-3',
      name: 'k',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: encrypted.keySource,
      payload: encrypted.payload,
      lastRotatedAt: null,
      lastTestedAt: null,
    })

    const resolver = new FactorySecretResolver({ factoryDir, secrets, accessLog })
    expect(resolver.resolve('secret:secret-3')).toBe('val')
    expect(accessLog.listBySecret('secret-3')).toMatchObject([
      {
        secretId: 'secret-3',
        runId: null,
        agentId: null,
        outcome: 'success',
        errorMessage: null,
      },
    ])
  })

  it('does not re-label successful decrypts as secret failures when audit writing fails', async () => {
    const factoryDir = await factoryDirWithKey()
    context = createRepoContext()
    const secrets = new SqliteFactorySecretRepo(context.db)
    const encrypted = encryptFactorySecret('val', loadFactorySecretKey(factoryDir))
    secrets.create({
      id: 'secret-audit-fails',
      name: 'k',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: encrypted.keySource,
      payload: encrypted.payload,
      lastRotatedAt: null,
      lastTestedAt: null,
    })
    const calls: FactorySecretAccessEventInput[] = []
    const resolver = new FactorySecretResolver({
      factoryDir,
      secrets,
      accessLog: {
        record: (input) => {
          calls.push(input)
          throw new Error('audit write failed')
        },
      },
    })

    expect(() => resolver.resolve('secret:secret-audit-fails')).toThrow(/audit write failed/)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      secretId: 'secret-audit-fails',
      outcome: 'success',
      errorMessage: null,
    })
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
