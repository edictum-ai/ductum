import {
  ORPHANED_REATTACH_FAILURE_REASON,
  reconcileOrphanedSessions,
} from '@ductum/core'

import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type TestFixture, vi } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - startup reconcile visibility', () => {
  it('exposes restart reconcile evidence for attempts stalled on startup', async () => {
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
      completedStages: ['understand'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-startup',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/startup-reconcile'],
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
      sessionId: 'session-startup',
      runId: run.id,
      harness: 'codex-sdk',
      workingDir: '/tmp/startup-reconcile',
      harnessSessionId: 'thread-startup',
    })

    const summary = await reconcileOrphanedSessions({
      runRepo: fixture.repos.runs,
      taskRepo: fixture.repos.tasks,
      sessionMappingRepo: fixture.repos.sessionRunMappings,
      agentRepo: fixture.repos.agents,
      stateMachine: fixture.context.stateMachine,
      harnessAdapters: new Map(),
      activeSessions: new Map(),
      evidenceRepo: fixture.repos.evidence,
      resolveRuntimeAgentForRun: () => null,
      createMcpServer: vi.fn(),
      closeMcpServer: vi.fn(),
      onSessionEnd: vi.fn(),
      now: () => new Date('2026-06-14T12:00:00.000Z'),
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`)
    const evidence = result.json as Array<{ payload: Record<string, unknown> }>

    expect(summary).toMatchObject({ scanned: 1, stalled: [run.id], noAdapter: [run.id] })
    expect(fixture.repos.runs.get(run.id)?.failReason).toContain(ORPHANED_REATTACH_FAILURE_REASON)
    expect(result.response.status).toBe(200)
    expect(evidence.at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'startup_orphan_sessions',
      restartTime: '2026-06-14T12:00:00.000Z',
      attemptId: run.id,
      affectedAttemptIds: [run.id],
      counts: { scanned: 1, live: 0, reattached: 0, stalled: 1, noMapping: 0, noAdapter: 1, errors: 0 },
      stalledReasons: [{ runId: run.id, reason: `${ORPHANED_REATTACH_FAILURE_REASON} (no adapter for codex-sdk)` }],
    })
  })
})
