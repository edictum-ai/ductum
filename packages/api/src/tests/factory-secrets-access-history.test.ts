import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FactorySecretResolver } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fixture?.close()
  fixture = undefined
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('FactorySecret access-history API (P1 / issue #210)', () => {
  it('records resolution attempts from the resolver and exposes them value-free via the secret + run routes', async () => {
    const factoryDir = await factoryDirWithKey()
    let now = new Date('2026-07-01T00:00:00.000Z')
    fixture = await createFixture({ factoryDataDir: factoryDir, now: () => now })
    const { builder, task } = seedBase(fixture)
    // Seed a real run row so the run-scoped route's existence check passes.
    const runId = 'run-1-abc' as never
    fixture.repos.runs.create({
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: now.toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const plaintext = 'plain-api-secret-value'
    const created = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      body: { name: 'openai-api-key', value: plaintext },
    })
    const id = (created.json as { id: string }).id

    // Drive the resolver with threaded run/agent context, exactly as the
    // dispatcher-injected broker does. One success + one failure against a
    // missing secret.
    const resolver = new FactorySecretResolver({
      factoryDir,
      secrets: fixture.repos.secrets,
      accessLog: fixture.repos.secretAccessLog,
      now: () => now,
    })
    resolver.resolve(`secret:${id}`, { runId, agentId: builder.id })
    now = new Date('2026-07-01T00:05:00.000Z')
    expect(() => resolver.resolve('secret:missing', { runId, agentId: builder.id }))
      .toThrow(/Secret not found/)

    // Secret-scoped access history returns both events, newest first.
    const secretHistory = await requestJson(fixture.app, `/api/factory/secrets/${id}/access-history`)
    expect(secretHistory.response.status).toBe(200)
    const secretEvents = secretHistory.json as Array<Record<string, unknown>>
    expect(secretEvents).toHaveLength(1)
    expect(secretEvents[0]).toMatchObject({
      secretRef: `secret:${id}`,
      runId,
      agentId: builder.id,
      outcome: 'success',
      errorMessage: null,
    })

    // Run-scoped access history returns the same run's events across all secrets.
    const runHistory = await requestJson(fixture.app, `/api/runs/${runId}/secret-access-history`)
    expect(runHistory.response.status).toBe(200)
    const runEvents = runHistory.json as Array<Record<string, unknown>>
    expect(runEvents).toHaveLength(2)
    expect(runEvents[0]).toMatchObject({ outcome: 'failure', secretRef: 'secret:missing' })
    expect(runEvents[1]).toMatchObject({ outcome: 'success', secretRef: `secret:${id}` })

    const fractionalLimit = await requestJson(fixture.app, `/api/runs/${runId}/secret-access-history?limit=0.5`)
    expect(fractionalLimit.response.status).toBe(200)
    expect(fractionalLimit.json).toHaveLength(1)

    // Behavioral: serialization must never include plaintext, ciphertext, or
    // encrypted payload fields — even when the underlying error message
    // echoes the missing-secret ref.
    for (const body of [secretHistory.text, runHistory.text]) {
      expect(body).not.toContain(plaintext)
      expect(body).not.toContain('ciphertext')
      expect(body).not.toContain('payload')
      expect(body).not.toContain('authTag')
      expect(body).not.toContain('nonce')
      expect(body).not.toContain('keySource')
      expect(body).not.toContain('keyId')
      expect(body).not.toContain('secretId')
    }
    // Persisted events must also be value-free at the repo level.
    const stored = fixture.repos.secretAccessLog.listBySecret(id)
    expect(JSON.stringify(stored)).not.toContain(plaintext)
  })

  it('returns 404 for access-history on unknown secret/run ids without leaking existence', async () => {
    const factoryDir = await factoryDirWithKey()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    seedBase(fixture)

    const secretMissing = await requestJson(fixture.app, '/api/factory/secrets/nope/access-history')
    expect(secretMissing.response.status).toBe(404)

    const runMissing = await requestJson(fixture.app, '/api/runs/nope/secret-access-history')
    expect(runMissing.response.status).toBe(404)
  })
})

async function factoryDirWithKey(): Promise<string> {
  const dir = await tempFactoryDir()
  await writeKey(dir, randomBytes(32), 0o600)
  return dir
}

async function tempFactoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-api-secret-access-'))
  dirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  return dir
}

async function writeKey(factoryDir: string, key: Buffer, mode: number): Promise<void> {
  const keyPath = join(factoryDir, '.ductum', 'secrets.key')
  await writeFile(keyPath, key, { mode })
  await chmod(keyPath, mode)
}
