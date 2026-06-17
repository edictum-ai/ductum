import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

const NOW = new Date('2026-04-28T12:00:00.000Z')

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile-convergence', () => {
  it('reaches a fixed point for stale descendant runs and active tasks in one command', async () => {
    fixture = await createFixture({
      now: () => NOW,
      hasActiveSession: () => false,
    })
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const root = createRun(task, builder, {
      stage: 'implement',
      lastHeartbeat: new Date(NOW.getTime() - 900_000).toISOString(),
    })
    const fixTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-rest-api-r1',
      prompt: 'fix',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const child = createRun(fixTask, builder, {
      parentRunId: root.id,
      lastHeartbeat: new Date(NOW.getTime() - 900_000).toISOString(),
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.converged).toBe(true)
    expect(result.passes).toBe(3)
    expect(result.runsReconciled).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: child.id, reason: 'orphaned' }),
      expect.objectContaining({ runId: root.id, reason: 'orphaned' }),
    ]))
    expect(result.tasksReconciled).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: fixTask.id, toStatus: 'failed' }),
      expect.objectContaining({ taskId: task.id, toStatus: 'failed' }),
    ]))
    expect(fixture.repos.runs.get(child.id)?.terminalState).toBe('failed')
    expect(fixture.repos.runs.get(root.id)?.terminalState).toBe('failed')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('failed')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
  })

  it('stops at maxPasses and reports non-convergence', async () => {
    fixture = await createFixture({
      now: () => NOW,
      hasActiveSession: () => false,
    })
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const root = createRun(task, builder, {
      lastHeartbeat: new Date(NOW.getTime() - 900_000).toISOString(),
    })
    const childTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-rest-api',
      prompt: 'review',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const child = createRun(childTask, builder, {
      parentRunId: root.id,
      lastHeartbeat: new Date(NOW.getTime() - 900_000).toISOString(),
    })

    const result = await reconcileInconsistentRuns(fixture.context, { maxPasses: 1 })

    expect(result.converged).toBe(false)
    expect(result.passes).toBe(1)
    expect(result.runsReconciled).toEqual([
      expect.objectContaining({ runId: child.id, reason: 'orphaned' }),
    ])
    expect(fixture.repos.runs.get(root.id)?.terminalState).toBeNull()
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
  })

  it('preserves the conservative one-hour orphan fallback when dispatcher liveness is unavailable', async () => {
    fixture = await createFixture({ now: () => NOW })
    const { task, spec, builder } = seedBase(fixture)

    const recent = createRun(task, builder, {
      lastHeartbeat: new Date(NOW.getTime() - 600_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })
    const staleTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'stale-rest-api',
      prompt: 'stale run',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: [],
    })
    const stale = createRun(staleTask, builder, {
      lastHeartbeat: new Date(NOW.getTime() - 7_200_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.converged).toBe(true)
    expect(result.runsReconciled.find((entry) => entry.runId === recent.id)).toBeUndefined()
    expect(result.runsReconciled).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: stale.id, reason: 'orphaned' }),
    ]))
    expect(fixture.repos.runs.get(recent.id)?.terminalState).toBeNull()
    expect(fixture.repos.runs.get(stale.id)?.terminalState).toBe('failed')
  })

  it('preserves a stale heartbeat run while dispatcher liveness reports a live session', async () => {
    fixture = await createFixture({
      now: () => NOW,
      hasActiveSession: () => true,
    })
    const { task, builder } = seedBase(fixture)

    const run = createRun(task, builder, {
      lastHeartbeat: new Date(NOW.getTime() - 7_200_000).toISOString(),
      heartbeatTimeoutSeconds: 300,
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.converged).toBe(true)
    expect(result.runsReconciled.find((entry) => entry.runId === run.id)).toBeUndefined()
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
    lastHeartbeat: NOW.toISOString(),
    heartbeatTimeoutSeconds: 300,
    ...overrides,
  })
}
