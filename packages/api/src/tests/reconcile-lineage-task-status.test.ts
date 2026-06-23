import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile lineage task status', () => {
  it('marks an active fix task done when its attempt is already done', async () => {
    fixture = await createFixture()
    const { spec, builder } = seedBase(fixture)
    const fixTask = createTask(spec.id, builder.id, 'fix-P1-r1', 'active')
    const fixRun = createRun(fixTask, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled).toContainEqual(expect.objectContaining({
      taskId: fixTask.id,
      toStatus: 'done',
      auditRunId: fixRun.id,
    }))
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('done')
  })

  it('returns an active fix task with no attempt to ready', async () => {
    fixture = await createFixture()
    const { spec, builder } = seedBase(fixture)
    const fixTask = createTask(spec.id, builder.id, 'fix-P1-r2', 'active')

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled).toContainEqual(expect.objectContaining({
      taskId: fixTask.id,
      toStatus: 'ready',
      reason: 'active lineage task has no attempt',
    }))
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('ready')
  })

  it('does not mark a root implementation task done just because its run is done', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled.find((entry) => entry.taskId === task.id)).toBeUndefined()
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
  })

  it('marks a failed fix task done when a later lineage follow-up completed', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const failedFix = createTask(spec.id, builder.id, 'fix-P1-r1', 'failed')
    createRun(failedFix, builder, { terminalState: 'failed', failReason: 'review still failing' })
    const completedReview = createTask(spec.id, builder.id, 'review-P1-r2', 'done')
    const completedRun = createRun(completedReview, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled).toContainEqual(expect.objectContaining({
      taskId: failedFix.id,
      fromStatus: 'failed',
      toStatus: 'done',
      auditRunId: completedRun.id,
    }))
    expect(fixture.repos.tasks.get(failedFix.id)?.status).toBe('done')
    expect(fixture.repos.specs.get(spec.id)?.status).toBe('done')
  })

  it('keeps a failed fix task failed when no later lineage follow-up completed', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const failedFix = createTask(spec.id, builder.id, 'fix-P1-r2', 'failed')
    createRun(failedFix, builder, { terminalState: 'failed', failReason: 'still broken' })
    const earlierReview = createTask(spec.id, builder.id, 'review-P1-r1', 'done')
    createRun(earlierReview, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled.find((entry) => entry.taskId === failedFix.id)).toBeUndefined()
    expect(fixture.repos.tasks.get(failedFix.id)?.status).toBe('failed')
  })

  it('does not repair failed implementation tasks from lineage follow-up state', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    createRun(task, builder, { terminalState: 'failed', failReason: 'implementation failed' })
    const completedReview = createTask(spec.id, builder.id, 'review-REST API-r2', 'done')
    createRun(completedReview, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled.find((entry) => entry.taskId === task.id)).toBeUndefined()
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
  })

  it('reports stale failed lineage repairs in dry-run without writing state', async () => {
    fixture = await createFixture()
    const { spec, builder } = seedBase(fixture)
    const failedReview = createTask(spec.id, builder.id, 'review-P1-r1', 'failed')
    createRun(failedReview, builder, { terminalState: 'failed', failReason: 'needs fixes' })
    const completedFix = createTask(spec.id, builder.id, 'fix-P1-r1', 'done')
    const completedRun = createRun(completedFix, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    expect(result.tasksReconciled).toContainEqual(expect.objectContaining({
      taskId: failedReview.id,
      fromStatus: 'failed',
      toStatus: 'done',
      auditRunId: completedRun.id,
    }))
    expect(result.tasksReconciled.find((entry) => entry.taskId === failedReview.id)?.audit).toBeUndefined()
    expect(fixture.repos.tasks.get(failedReview.id)?.status).toBe('failed')
    expect(fixture.repos.evidence.list(completedRun.id)).toEqual([])
  })

  it('repairs nested failed follow-up review tasks after a later nested fix completed', async () => {
    fixture = await createFixture()
    const { spec, builder } = seedBase(fixture)
    const failedNestedReview = createTask(spec.id, builder.id, 'review-fix-P1-r7', 'failed')
    createRun(failedNestedReview, builder, { terminalState: 'failed', failReason: 'nested review failed' })
    const completedNestedFix = createTask(spec.id, builder.id, 'fix-fix-P1-r9-r1', 'done')
    const completedRun = createRun(completedNestedFix, builder, { stage: 'done' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled).toContainEqual(expect.objectContaining({
      taskId: failedNestedReview.id,
      fromStatus: 'failed',
      toStatus: 'done',
      auditRunId: completedRun.id,
    }))
    expect(fixture.repos.tasks.get(failedNestedReview.id)?.status).toBe('done')
  })
})

function createTask(specId: Task['specId'], agentId: Agent['id'], name: string, status: Task['status']) {
  if (fixture == null) throw new Error('test fixture missing')
  return fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId,
    name,
    prompt: name,
    repos: ['packages/api'],
    assignedAgentId: agentId,
    requiredRole: name.startsWith('review-') ? 'reviewer' : 'builder',
    status,
    verification: [],
  })
}

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
