import { createId } from '@ductum/core'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import { seedCancelRun } from './run-cancel.helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('API routes - operator cancel', () => {
  it('cancels a live run, frees the dispatcher session, records evidence, and emits SSE event data', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: {
        stage: 'ship',
        blockedReason: 'waiting for approval',
        pendingApproval: true,
        sessionId: 'session-1',
        branch: 'feat/cancel',
        commitSha: 'abc123',
        worktreePaths: ['/tmp/ductum-cancel-test'],
        failReason: 'old latch',
        tokensIn: 10,
        tokensOut: 20,
        costUsd: 1.23456,
      },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'operator chose another attempt' },
    })

    expect(result.response.status).toBe(200)
    expect(killRun).toHaveBeenCalledWith(run.id, 'cancelled')
    expect(result.json).toMatchObject({
      schemaVersion: 1,
      kind: 'run.cancelled',
      data: {
        run: {
          id: run.id,
          terminalState: 'cancelled',
          failReason: null,
          recoverable: false,
          pendingApproval: false,
          blockedReason: null,
        },
        cost: { tokensIn: 10, tokensOut: 20, usd: 1.2346 },
        worktreePreserved: true,
        cleanupAt: null,
      },
    })
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
    expect(fixture.repos.evidence.list(run.id)[0]?.payload).toMatchObject({
      kind: 'operator.cancel',
      reason: 'operator chose another attempt',
      worktreePreserved: true,
      cleanupAt: null,
    })
    expect(fixture.repos.runHistory.list(run.id)[0]).toMatchObject({
      fromStage: 'ship',
      toStage: 'ship',
      reason: 'cancelled: operator chose another attempt',
    })
    expect(fixture.context.events.getAfter(null).at(-1)?.event).toMatchObject({
      type: 'run.cancelled',
      runId: run.id,
      reason: 'operator chose another attempt',
      worktreePreserved: true,
      cleanupAt: null,
    })
  })

  it('records dirtyWorktree for preserved cancelled worktrees', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'ductum-cancel-dirty-'))
    try {
      execFileSync('git', ['init'], { cwd: worktree })
      await writeFile(join(worktree, 'dirty.txt'), 'dirty\n')
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = seedCancelRun(fixture, {
        taskId: task.id,
        agentId: builder.id,
        overrides: { worktreePaths: [worktree] },
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
        method: 'POST',
        body: { reason: 'dirty worktree needs inspection' },
      })

      expect(result.response.status).toBe(200)
      expect(fixture.repos.evidence.list(run.id)[0]?.payload).toMatchObject({
        kind: 'operator.cancel',
        worktreePreserved: true,
        dirtyWorktree: true,
      })
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  it('removes worktree paths only when cleanup is requested', async () => {
    const cleanupRunWorktrees = vi.fn(async () => ['/tmp/ductum-cancel-test'])
    fixture = await createFixture({
      cleanupRunWorktrees,
      now: () => new Date('2026-05-03T12:00:00.000Z'),
    })
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { worktreePaths: ['/tmp/ductum-cancel-test'] },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'operator cleanup requested', cleanupWorktree: true },
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

  it('removes generated run-scoped Codex home when cleanup is requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ductum-cancel-codex-home-'))
    try {
      const runId = createId<'RunId'>()
      const worktreeBasePath = join(root, '.ductum', 'worktrees')
      const attemptDir = join(worktreeBasePath, 'ductum', `REST-API-${runId.slice(0, 6)}`)
      const worktree = join(attemptDir, 'ductum')
      await mkdir(worktree, { recursive: true })
      fixture = await createFixture({
        now: () => new Date('2026-05-03T12:00:00.000Z'),
        runtime: { worktreeBasePath },
      })
      const { task, builder } = seedBase(fixture)
      const run = seedCancelRun(fixture, {
        taskId: task.id,
        agentId: builder.id,
        overrides: { id: runId, stage: 'understand', worktreePaths: [worktree] },
      })
      const generatedHome = join(attemptDir, '.codex-home', run.id)
      await mkdir(generatedHome, { recursive: true })
      await writeFile(join(generatedHome, 'state.sqlite'), 'state\n')

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
        method: 'POST',
        body: { reason: 'operator cleanup requested', cleanupWorktree: true },
      })

      expect(result.response.status).toBe(200)
      expect(existsSync(worktree)).toBe(false)
      expect(existsSync(generatedHome)).toBe(false)
      expect(existsSync(attemptDir)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains external worktree parents when cleanup removes a Codex home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ductum-cancel-external-codex-home-'))
    try {
      const runId = createId<'RunId'>()
      const externalParent = join(root, 'operator-managed')
      const worktree = join(externalParent, 'ductum')
      await mkdir(worktree, { recursive: true })
      fixture = await createFixture({
        now: () => new Date('2026-05-03T12:00:00.000Z'),
        runtime: { worktreeBasePath: join(root, '.ductum', 'worktrees') },
      })
      const { task, builder } = seedBase(fixture)
      const run = seedCancelRun(fixture, {
        taskId: task.id,
        agentId: builder.id,
        overrides: { id: runId, stage: 'understand', worktreePaths: [worktree] },
      })
      const generatedHome = join(externalParent, '.codex-home', run.id)
      await mkdir(generatedHome, { recursive: true })
      await writeFile(join(generatedHome, 'state.sqlite'), 'state\n')

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
        method: 'POST',
        body: { reason: 'operator cleanup requested', cleanupWorktree: true },
      })

      expect(result.response.status).toBe(200)
      expect(existsSync(worktree)).toBe(false)
      expect(existsSync(generatedHome)).toBe(false)
      expect(existsSync(externalParent)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns a structured error envelope for terminal runs', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = seedCancelRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      overrides: { terminalState: 'failed', failReason: 'already failed', recoverable: false },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'too late' },
    })

    expect(result.response.status).toBe(409)
    expect(result.json).toMatchObject({
      schemaVersion: 1,
      kind: 'error',
      data: {
        code: 'run_cancel_conflict',
        recoverable: true,
        context: { runId: run.id },
      },
    })
  })
})
