import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeCleanupError } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let tempRoots: string[] = []

afterEach(() => {
  fixture?.close()
  fixture = undefined
  for (const root of tempRoots.splice(0)) {
    rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function withTempWorktreeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ductum-ops-health-cleanup-'))
  tempRoots.push(root)
  return root
}

describe('POST /api/factory/ops-health/cleanup-worktrees', () => {
  it('fails closed without an explicit confirmation body', async () => {
    fixture = await createFixture({})
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: {},
    })
    expect(res.response.status).toBe(400)
    expect(res.json).toMatchObject({
      error: expect.stringMatching(/explicit confirmation/i),
    })
  })

  it('fails closed when confirm is not the literal boolean true', async () => {
    fixture = await createFixture({})
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: 'yes' },
    })
    expect(res.response.status).toBe(400)
  })

  it('reports unavailable when the cleanup primitive is not wired', async () => {
    fixture = await createFixture({})
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: true },
    })
    expect(res.response.status).toBe(200)
    expect(res.json).toMatchObject({
      outcome: 'unavailable',
      removed: 0,
      reason: expect.stringMatching(/not loaded|dispatcher/i),
    })
  })

  it('reports unavailable when a cleanup function exists but worktree isolation is off', async () => {
    let calls = 0
    fixture = await createFixture({
      cleanupWorktrees: async () => {
        calls += 1
        return 0
      },
      runtime: {
        worktreeEnabled: false,
        worktreeBasePath: await withTempWorktreeBase(),
      },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: true },
    })
    expect(res.response.status).toBe(200)
    expect(calls).toBe(0)
    expect(res.json).toMatchObject({
      outcome: 'unavailable',
      removed: 0,
      reason: expect.stringMatching(/worktree isolation/i),
    })
  })

  it('reuses the dispatcher cleanup primitive and reports the removed count on success', async () => {
    let calls = 0
    const basePath = await withTempWorktreeBase()
    fixture = await createFixture({
      cleanupWorktrees: async () => {
        calls += 1
        return 3
      },
      runtime: {
        dispatcherEnabled: true,
        worktreeEnabled: true,
        worktreeBasePath: basePath,
      },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: true },
    })
    expect(res.response.status).toBe(200)
    expect(calls).toBe(1)
    expect(res.json).toMatchObject({
      outcome: 'success',
      removed: 3,
      reason: null,
    })
  })

  it('returns an error outcome when the cleanup primitive throws', async () => {
    const basePath = await withTempWorktreeBase()
    fixture = await createFixture({
      cleanupWorktrees: async () => {
        throw new Error('boom')
      },
      runtime: {
        dispatcherEnabled: true,
        worktreeEnabled: true,
        worktreeBasePath: basePath,
      },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: true },
    })
    expect(res.response.status).toBe(200)
    expect(res.json).toMatchObject({
      outcome: 'error',
      removed: 0,
      reason: 'boom',
    })
  })

  it('reports partial removals when strict cleanup fails after deleting worktrees', async () => {
    const basePath = await withTempWorktreeBase()
    fixture = await createFixture({
      cleanupWorktrees: async () => {
        throw new WorktreeCleanupError(2, 'late cleanup failure')
      },
      runtime: {
        dispatcherEnabled: true,
        worktreeEnabled: true,
        worktreeBasePath: basePath,
      },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
      method: 'POST',
      body: { confirm: true },
    })
    expect(res.response.status).toBe(200)
    expect(res.json).toMatchObject({
      outcome: 'error',
      removed: 2,
      reason: expect.stringMatching(/2 inactive worktree/i),
    })
  })
})
