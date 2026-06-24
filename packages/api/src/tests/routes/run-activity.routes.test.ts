import { SESSION_CONTROL_TOKEN_HEADER } from '../../lib/session-control.js'
import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - run activity log', () => {
  it('returns the LATEST N events in chronological order, honoring ?limit=', async () => {
    fixture = await createFixture()
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
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    // 250 events — past the historical 200-event default
    for (let i = 0; i < 250; i++) {
      fixture.repos.runActivity.create(run.id, 'tool_call', `event-${i}`, 'Read')
    }

    type ActivityRow = { content: string }

    // Default limit returns the LATEST 200 (not the first 200)
    const dflt = await requestJson(fixture.app, `/api/runs/${run.id}/activity`)
    expect(dflt.response.status).toBe(200)
    const dfltActivity = dflt.json as ActivityRow[]
    expect(dfltActivity).toHaveLength(200)
    expect(dfltActivity[0]?.content).toBe('event-50')
    expect(dfltActivity[199]?.content).toBe('event-249')

    // Explicit larger limit returns more, still chronological
    const wider = await requestJson(fixture.app, `/api/runs/${run.id}/activity?limit=300`)
    const widerActivity = wider.json as ActivityRow[]
    expect(widerActivity).toHaveLength(250)
    expect(widerActivity[0]?.content).toBe('event-0')
    expect(widerActivity[249]?.content).toBe('event-249')

    // Smaller limit also works
    const narrow = await requestJson(fixture.app, `/api/runs/${run.id}/activity?limit=10`)
    const narrowActivity = narrow.json as ActivityRow[]
    expect(narrowActivity).toHaveLength(10)
    expect(narrowActivity[0]?.content).toBe('event-240')
    expect(narrowActivity[9]?.content).toBe('event-249')

    // Invalid limit falls back to default 200
    const invalid = await requestJson(fixture.app, `/api/runs/${run.id}/activity?limit=not-a-number`)
    const invalidActivity = invalid.json as ActivityRow[]
    expect(invalidActivity).toHaveLength(200)
  })

  it('caps the limit query at the server-side hard ceiling', async () => {
    fixture = await createFixture()
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
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.runActivity.create(run.id, 'text', 'just one event')

    // Even with absurd limit, the route never throws
    const huge = await requestJson(fixture.app, `/api/runs/${run.id}/activity?limit=99999999`)
    expect(huge.response.status).toBe(200)
    expect((huge.json as unknown[])).toHaveLength(1)
  })

  it('requires the current session control token for leased run activity writes', async () => {
    fixture = await createFixture()
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
      lastHeartbeat: new Date().toISOString(),
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
      now: new Date(),
    })

    const stale = await requestJson(fixture.app, `/api/runs/${run.id}/activity`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: 'stale-token' },
      body: { kind: 'tool_call', content: 'tail -40', toolName: 'Bash' },
    })
    expect(stale.response.status).toBe(403)

    const ok = await requestJson(fixture.app, `/api/runs/${run.id}/activity`, {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: currentMapping.controlToken },
      body: { kind: 'tool_call', content: 'tail -40', toolName: 'Bash' },
    })
    expect(ok.response.status).toBe(201)
  })
})
