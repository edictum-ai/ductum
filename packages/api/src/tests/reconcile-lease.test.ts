import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile lease truth', () => {
  it('does not orphan-fail a stale run that still has a valid active lease', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      lastHeartbeat: new Date(Date.now() - 7200_000).toISOString(),
    })
    fixture.repos.attemptLeases.acquire({
      attemptId: run.id,
      runId: run.id,
      sessionId: run.sessionId,
      ownerProcessId: 'live-owner',
      ttlMs: 60_000,
      now: new Date(Date.now() + 30_000),
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.runsReconciled.find((item) => item.runId === run.id)).toBeUndefined()
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()
  })

  it('reports expired active leases as dead-claim in dry-run without mutating lease state', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      lastHeartbeat: new Date(Date.now() - 7200_000).toISOString(),
    })
    fixture.repos.attemptLeases.acquire({
      attemptId: run.id,
      runId: run.id,
      sessionId: run.sessionId,
      ownerProcessId: 'dead-owner',
      ttlMs: 1_000,
      now: new Date(Date.now() - 7200_000),
    })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    expect(result.runsReconciled.find((item) => item.runId === run.id)).toMatchObject({
      reason: 'orphaned',
      disposition: 'dead-claim',
    })
    expect(fixture.repos.attemptLeases.getLatestForRun(run.id)?.status).toBe('active')
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()
  })
})

function createRun(task: Task, agent: Agent, overrides: Partial<Run> = {}) {
  if (fixture == null) throw new Error('test fixture missing')
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: agent.id,
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
    heartbeatTimeoutSeconds: 300,
    ...overrides,
  })
}
