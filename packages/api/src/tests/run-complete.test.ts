import { createId, type Run } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'
import { SESSION_CONTROL_TOKEN_HEADER } from '../lib/session-control.js'

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

  it('requires the active session token before completing a leased done run', async () => {
    const now = new Date('2026-04-28T07:00:00.000Z')
    fixture = await createFixture({ hasActiveSession: () => true, now: () => now })
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task.id, builder.id, { stage: 'done', sessionId: 'session-current' })
    const staleLease = fixture.repos.attemptLeases.acquire({
      attemptId: 'attempt-stale',
      runId: run.id,
      sessionId: 'session-stale',
      ownerProcessId: 'process-stale',
      ttlMs: 60_000,
      now,
    })
    fixture.repos.attemptLeases.release({ runId: run.id, fenceToken: staleLease.fenceToken, now })
    fixture.repos.attemptLeases.acquire({
      attemptId: 'attempt-current',
      runId: run.id,
      sessionId: 'session-current',
      ownerProcessId: 'process-current',
      ttlMs: 60_000,
      now,
    })
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-stale',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'stale-token',
    })
    const currentMapping = fixture.repos.sessionRunMappings.create({
      sessionId: 'session-current',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'current-token',
    })

    const missingToken = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      body: { result: 'missing token should not complete this leased run' },
    })
    expect(missingToken.response.status).toBe(400)

    const staleToken = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: 'stale-token' },
      body: { result: 'stale token should not complete this leased run' },
    })
    expect(staleToken.response.status).toBe(403)
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')

    const currentToken = await requestJson(fixture.app, `/api/runs/${run.id}/complete`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: currentMapping.controlToken },
      body: { result: 'current token is allowed to complete this leased run' },
    })
    expect(currentToken.response.status).toBe(200)
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
