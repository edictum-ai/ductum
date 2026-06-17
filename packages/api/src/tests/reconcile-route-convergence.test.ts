import { createId } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

const NOW = new Date('2026-04-28T12:00:00.000Z')

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile-route-convergence', () => {
  it('POST /api/runs/reconcile uses each run heartbeat timeout when dispatcher reports no live session', async () => {
    fixture = await createFixture({
      now: () => NOW,
      hasActiveSession: () => false,
    })
    const { task, spec, builder } = seedBase(fixture)

    const staleRun = fixture.repos.runs.create({
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
      lastHeartbeat: new Date(NOW.getTime() - 360_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })

    const freshTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'Fresh API',
      prompt: 'fresh heartbeat',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const freshRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: freshTask.id,
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
      lastHeartbeat: new Date(NOW.getTime() - 240_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: {},
    })

    expect(response.response.status).toBe(200)
    const result = response.json as {
      converged: boolean
      passes: number
      runsReconciled: Array<{ runId: string; reason: string }>
    }
    expect(result.converged).toBe(true)
    expect(result.passes).toBe(2)
    expect(result.runsReconciled).toEqual([
      expect.objectContaining({ runId: staleRun.id, reason: 'orphaned' }),
    ])
    expect(fixture.repos.runs.get(staleRun.id)?.terminalState).toBe('failed')
    expect(fixture.repos.runs.get(freshRun.id)?.terminalState).toBeNull()
  })

  it('POST /api/runs/reconcile dryRun=true stays read-only while reporting visible candidates', async () => {
    fixture = await createFixture({
      now: () => NOW,
      hasActiveSession: () => false,
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
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date(NOW.getTime() - 360_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: { dryRun: true },
    })

    expect(response.response.status).toBe(200)
    const result = response.json as {
      dryRun: boolean
      converged: boolean
      passes: number
      runsReconciled: Array<{ runId: string; reason: string; audit?: unknown }>
    }
    expect(result.dryRun).toBe(true)
    expect(result.converged).toBe(false)
    expect(result.passes).toBe(1)
    expect(result.runsReconciled).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: run.id, reason: 'orphaned' }),
    ]))
    expect(result.runsReconciled[0]?.audit).toBeUndefined()
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })
})
