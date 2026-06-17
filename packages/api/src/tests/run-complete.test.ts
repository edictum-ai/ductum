import { createId, type Run } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  fixture?.close()
  fixture = undefined
})

describe('run completion visibility', () => {
  it('fails loudly for non-done runs without a live session and records no progress', async () => {
    fixture = await createFixture({ hasActiveSession: () => false })
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task.id, builder.id, { stage: 'understand', sessionId: null })
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      body: {
        result: 'this should not be recorded as a completion result',
        pr: 'https://github.com/acartag7/ductum/pull/99',
      },
    })

    expect(response.response.status).toBe(409)
    expect(response.json).toEqual({ error: expect.stringContaining('no live session') })
    expect(fixture.repos.runs.get(run.id)?.stage).toBe('understand')
    expect(fixture.repos.runs.get(run.id)?.prUrl).toBeNull()
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.runUpdates.list(run.id)).toHaveLength(0)
  })

  it('signals live-session completion without marking the task done immediately', async () => {
    const endSession = vi.fn().mockResolvedValue(undefined)
    fixture = await createFixture({ hasActiveSession: () => true, endSession })
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task.id, builder.id, { stage: 'implement', sessionId: 'live-session' })
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      body: { result: 'implementation completed with verification passing cleanly' },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(response.response.status).toBe(200)
    expect(fixture.repos.runs.get(run.id)?.stage).toBe('implement')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toContain('implementation completed')
    expect(endSession).toHaveBeenCalledWith(run.id)
  })

  it('fails loudly for terminal failed and stalled runs', async () => {
    fixture = await createFixture({ hasActiveSession: () => false })
    const { task, builder } = seedBase(fixture)
    for (const terminalState of ['failed', 'stalled'] as const) {
      const run = createRun(fixture, task.id, builder.id, { stage: 'understand', terminalState })
      const response = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
        method: 'POST',
        body: { result: `terminal ${terminalState} should not complete` },
      })

      expect(response.response.status).toBe(409)
      expect(response.json).toEqual({ error: expect.stringContaining(`already ${terminalState}`) })
      expect(fixture.repos.runUpdates.list(run.id)).toHaveLength(0)
    }
  })

  it('preserves done-stage DAG finalization', async () => {
    fixture = await createFixture({ hasActiveSession: () => false })
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task.id, builder.id, { stage: 'done' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      body: { result: 'done-stage run finalized by operator' },
    })

    expect(response.response.status).toBe(200)
    expect(fixture.repos.runs.get(run.id)?.stage).toBe('done')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('done')
  })
})

function createRun(
  fixture: TestFixture,
  taskId: Run['taskId'],
  agentId: Run['agentId'],
  overrides: Partial<Run> = {},
): Run {
  const now = '2026-04-28T07:00:00.000Z'
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId,
    agentId,
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
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: now,
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}
