import { SESSION_CONTROL_TOKEN_HEADER } from '../../lib/session-control.js'
import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - run heartbeat', () => {
  it('renews a leased run heartbeat only for the current session token', async () => {
    let now = new Date('2026-06-24T10:00:00.000Z')
    fixture = await createFixture({ now: () => now })
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
      sessionId: 'session-2',
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
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-1',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'stale-token',
    })
    fixture.repos.sessionRunMappings.delete('session-1')
    const currentMapping = fixture.repos.sessionRunMappings.create({
      sessionId: 'session-2',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'current-token',
    })
    fixture.repos.attemptLeases.acquire({
      attemptId: 'attempt-2',
      runId: run.id,
      sessionId: currentMapping.sessionId,
      ownerProcessId: 'worker-2',
      ttlMs: 240_000,
      now,
    })

    const stale = await requestJson(fixture.app, `/api/runs/${run.id}/heartbeat`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: 'stale-token' },
    })
    expect(stale.response.status).toBe(403)

    const before = fixture.repos.attemptLeases.getLatestForRun(run.id)!
    now = new Date('2026-06-24T10:02:00.000Z')
    const refreshed = await requestJson(fixture.app, `/api/runs/${run.id}/heartbeat`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: currentMapping.controlToken },
    })
    expect(refreshed.response.status).toBe(200)
    const after = fixture.repos.attemptLeases.getLatestForRun(run.id)!
    expect(new Date(after.renewedAt).getTime()).toBeGreaterThan(new Date(before.renewedAt).getTime())
    expect(new Date(after.expiresAt).getTime()).toBeGreaterThan(new Date(before.expiresAt).getTime())
  })
})
