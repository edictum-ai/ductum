import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import { seedCancelRun } from './run-cancel.helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('API routes - operator cancel process cleanup', () => {
  it('records operator-visible evidence when active-session kill fails', async () => {
    const killRun = vi.fn(async () => {
      throw new Error('adapter refused kill')
    })
    fixture = await createFixture({ hasActiveSession: () => true, killRun })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { sessionId: 'session-1' },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'stuck live session' },
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      data: {
        processCleanup: {
          method: 'active-session-failed',
          orphan: { outcome: 'failed', reason: 'adapter refused kill' },
        },
      },
    })
    expect(fixture.repos.evidence.list(run.id).map((evidence) => evidence.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operator.cancel.process-cleanup-failed',
        reason: 'adapter refused kill',
      }),
    ]))
  })

  it('preserves worktrees when active-session kill fails with cleanup requested', async () => {
    const killRun = vi.fn(async () => {
      throw new Error('adapter refused kill')
    })
    const cleanupRunWorktrees = vi.fn(async () => ['/tmp/ductum-cancel-live'])
    fixture = await createFixture({
      hasActiveSession: () => true,
      killRun,
      cleanupRunWorktrees,
      now: () => new Date('2026-05-03T12:00:00.000Z'),
    })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { sessionId: 'session-1', worktreePaths: ['/tmp/ductum-cancel-live'] },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'stuck live session', cleanupWorktree: true },
    })

    expect(result.response.status).toBe(200)
    expect(cleanupRunWorktrees).not.toHaveBeenCalled()
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toEqual(['/tmp/ductum-cancel-live'])
    expect(result.json).toMatchObject({
      data: {
        worktreePreserved: true,
        cleanupAt: null,
        processCleanup: {
          method: 'active-session-failed',
          orphan: { outcome: 'failed', reason: 'adapter refused kill' },
        },
      },
    })
    expect(fixture.repos.evidence.list(run.id).map((evidence) => evidence.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operator.cancel',
        worktreePreserved: true,
        cleanupAt: null,
      }),
      expect.objectContaining({
        kind: 'operator.cancel.process-cleanup-failed',
        reason: 'adapter refused kill',
      }),
    ]))
  })

  it('records operator-visible evidence when orphan cleanup fails', async () => {
    const cleanupOrphanWorker = vi.fn(async () => {
      throw new Error('SIGTERM refused')
    })
    fixture = await createFixture({
      hasActiveSession: () => false,
      cleanupOrphanWorker,
    })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { sessionId: 'session-1' },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'stale dispatcher session' },
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      data: {
        processCleanup: {
          method: 'orphan-fallback',
          orphan: {
            outcome: 'failed',
            reason: 'SIGTERM refused',
            pid: null,
            ownershipKind: null,
          },
        },
      },
    })
    expect(fixture.repos.evidence.list(run.id).map((evidence) => evidence.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operator.cancel',
        processCleanup: expect.objectContaining({
          method: 'orphan-fallback',
          orphan: expect.objectContaining({ outcome: 'failed', reason: 'SIGTERM refused' }),
        }),
      }),
      expect.objectContaining({
        kind: 'operator.cancel.process-cleanup-failed',
        reason: 'SIGTERM refused',
      }),
    ]))
    expect(fixture.repos.runUpdates.list(run.id).map((update) => update.message)).toContain(
      'process cleanup failed: SIGTERM refused (pid=unknown)',
    )
  })

  it('preserves worktrees when orphan cleanup is skipped without proving exit', async () => {
    const cleanupOrphanWorker = vi.fn(async () => ({
      attempted: false,
      outcome: 'skipped' as const,
      reason: 'worker start-time metadata missing',
      pid: 12345,
      ownershipKind: 'process-group' as const,
      startedAt: null,
    }))
    const cleanupRunWorktrees = vi.fn(async () => ['/tmp/ductum-cancel-orphan'])
    fixture = await createFixture({
      hasActiveSession: () => false,
      cleanupOrphanWorker,
      cleanupRunWorktrees,
    })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { sessionId: 'session-1', worktreePaths: ['/tmp/ductum-cancel-orphan'] },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'stale dispatcher session', cleanupWorktree: true },
    })

    expect(result.response.status).toBe(200)
    expect(cleanupRunWorktrees).not.toHaveBeenCalled()
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toEqual(['/tmp/ductum-cancel-orphan'])
    expect(result.json).toMatchObject({
      data: {
        worktreePreserved: true,
        cleanupAt: null,
        processCleanup: {
          method: 'orphan-fallback',
          orphan: { outcome: 'skipped', reason: 'worker start-time metadata missing' },
        },
      },
    })
  })

  it('allows worktree cleanup when orphan cleanup proves the worker already exited', async () => {
    const cleanupOrphanWorker = vi.fn(async () => ({
      attempted: false,
      outcome: 'skipped' as const,
      reason: 'worker process already exited',
      pid: 12345,
      ownershipKind: 'process' as const,
      startedAt: '2026-05-03T11:59:00.000Z',
    }))
    const cleanupRunWorktrees = vi.fn(async () => ['/tmp/ductum-cancel-exited'])
    fixture = await createFixture({
      hasActiveSession: () => false,
      cleanupOrphanWorker,
      cleanupRunWorktrees,
      now: () => new Date('2026-05-03T12:00:00.000Z'),
    })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { sessionId: 'session-1', worktreePaths: ['/tmp/ductum-cancel-exited'] },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'stale dispatcher session', cleanupWorktree: true },
    })

    expect(result.response.status).toBe(200)
    expect(cleanupRunWorktrees).toHaveBeenCalledWith(run.id)
    expect(fixture.repos.runs.get(run.id)?.worktreePaths).toBeNull()
    expect(result.json).toMatchObject({
      data: {
        worktreePreserved: false,
        cleanupAt: '2026-05-03T12:00:00.000Z',
      },
    })
  })
})
