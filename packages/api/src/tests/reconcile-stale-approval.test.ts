import { STARTUP_RESUME_UNAVAILABLE_REASON, createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile stale approvals', () => {
  it.each([
    'stale_slot_gc',
    STARTUP_RESUME_UNAVAILABLE_REASON,
  ])('restores recoverable stalled approvals (%s)', async (failReason) => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = createRun(task, builder, {
      stage: 'ship',
      terminalState: 'stalled',
      pendingApproval: true,
      branch: 'feature/ready',
      commitSha: 'abc1234',
      reviewStatus: 'pass',
      failReason,
      recoverable: true,
    })

    const result = await reconcileInconsistentRuns(fixture.context)
    const entry = result.runsReconciled.find((item) => item.runId === run.id)

    expect(entry).toMatchObject({
      runId: run.id,
      reason: 'stale_approval',
      resolution: 'restored',
    })
    expect(result.tasksReconciled.find((item) => item.taskId === task.id)).toBeUndefined()
    expect(fixture.repos.runs.get(run.id)).toMatchObject({
      stage: 'ship',
      terminalState: null,
      pendingApproval: true,
      failReason: null,
      recoverable: true,
    })
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    const evidence = fixture.repos.evidence.list(run.id).at(-1)
    expect(evidence?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'stale_approval',
      resolution: 'restored',
      before: expect.objectContaining({ terminalState: 'stalled', pendingApproval: true }),
      after: expect.objectContaining({ terminalState: null, pendingApproval: true }),
      taskStatus: { before: 'failed', after: 'active' },
    })
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
