import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

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
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: 'waiting for approval',
      pendingApproval: true,
      sessionId: 'session-1',
      branch: 'feat/cancel',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum-cancel-test'],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'old latch',
      recoverable: true,
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 1.23456,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
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

  it('removes worktree paths only when cleanup is requested', async () => {
    const cleanupRunWorktrees = vi.fn(async () => ['/tmp/ductum-cancel-test'])
    fixture = await createFixture({
      cleanupRunWorktrees,
      now: () => new Date('2026-05-03T12:00:00.000Z'),
    })
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
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
      worktreePaths: ['/tmp/ductum-cancel-test'],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
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

  it('returns a structured error envelope for terminal runs', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
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
      failReason: 'already failed',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-05-03T10:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
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
