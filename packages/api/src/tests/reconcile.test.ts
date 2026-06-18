import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcileInconsistentRuns', () => {
  it('does not orphan-fail a stale parent while a descendant run is still live', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const oldHeartbeat = new Date(Date.now() - 7200_000).toISOString()
    const parent = createRun(task, builder, {
      stage: 'implement',
      lastHeartbeat: oldHeartbeat,
    })

    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-rest-api',
      prompt: 'review',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    createRun(reviewTask, builder, {
      parentRunId: parent.id,
      stage: 'understand',
      lastHeartbeat: new Date().toISOString(),
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.runsReconciled.find((entry) => entry.runId === parent.id)).toBeUndefined()
    expect(fixture.repos.runs.get(parent.id)?.terminalState).toBeNull()
  })

  it('does not orphan-fail a stale run waiting for human approval', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const oldHeartbeat = new Date(Date.now() - 7200_000).toISOString()
    const run = createRun(task, builder, {
      stage: 'ship',
      pendingApproval: true,
      lastHeartbeat: oldHeartbeat,
      branch: 'feature/ready',
      commitSha: 'abc1234',
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.runsReconciled.find((entry) => entry.runId === run.id)).toBeUndefined()
    const current = fixture.repos.runs.get(run.id)
    expect(current?.terminalState).toBeNull()
    expect(current?.pendingApproval).toBe(true)
  })

  it('marks open fix descendants done when the root is already awaiting approval', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')

    const root = createRun(task, builder, {
      stage: 'ship',
      pendingApproval: true,
      branch: 'feature/ready',
      commitSha: 'abc1234',
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
    const fixRun = createRun(fixTask, builder, {
      parentRunId: root.id,
      stage: 'implement',
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.runsReconciled).toContainEqual(expect.objectContaining({
      runId: fixRun.id,
      reason: 'approval_lineage',
    }))
    expect(fixture.repos.runs.get(root.id)?.pendingApproval).toBe(true)
    expect(fixture.repos.runs.get(fixRun.id)?.stage).toBe('done')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('active')
    const evidence = expectReconcileAudit(fixRun.id, 'approval_lineage')
    expect(evidence.payload).toMatchObject({
      rootRunId: root.id,
      taskId: fixTask.id,
      taskStatus: { before: 'active', after: 'active' },
    })
  })

  it('records stale approval repair as visible run update and custom evidence', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      stage: 'done',
      blockedReason: 'waiting',
      pendingApproval: true,
    })

    const result = await reconcileInconsistentRuns(fixture.context)
    const entry = result.runsReconciled.find((item) => item.runId === run.id)

    expect(entry?.reason).toBe('stale_approval')
    expect(entry?.audit?.evidenceId).toEqual(expect.any(String))
    expect(fixture.repos.runs.get(run.id)?.pendingApproval).toBe(false)
    const evidence = expectReconcileAudit(run.id, 'stale_approval')
    expect(evidence.payload).toMatchObject({
      before: expect.objectContaining({ pendingApproval: true }),
      after: expect.objectContaining({ pendingApproval: false }),
    })
  })

  it('records orphaned run repair as visible audit evidence', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      lastHeartbeat: new Date(Date.now() - 7200_000).toISOString(),
    })

    const result = await reconcileInconsistentRuns(fixture.context)
    const entry = result.runsReconciled.find((item) => item.runId === run.id)

    expect(entry?.reason).toBe('orphaned')
    expect(entry?.disposition).toBe('genuinely-stalled')
    expect(entry?.audit?.updateId).toEqual(expect.any(Number))
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBe('failed')
    const evidence = expectReconcileAudit(run.id, 'orphaned')
    expect(evidence.payload).toMatchObject({ staleSeconds: expect.any(Number) })
  })

  it('records active task failure repair on the run that caused it', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder, {
      terminalState: 'failed',
      recoverable: false,
      failReason: 'attempt 1 failed',
    })
    const latest = createRun(task, builder, {
      terminalState: 'failed',
      recoverable: false,
      failReason: 'attempt 2 failed',
    })

    const result = await reconcileInconsistentRuns(fixture.context)
    const entry = result.tasksReconciled[0]

    expect(entry).toMatchObject({ taskId: task.id, toStatus: 'failed', auditRunId: latest.id })
    expect(entry?.audit?.evidenceId).toEqual(expect.any(String))
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
    const evidence = expectReconcileAudit(latest.id, 'task_failed')
    expect(evidence.payload).toMatchObject({
      taskId: task.id,
      taskStatus: { before: 'active', after: 'failed' },
      taskReason: 'attempt 2 failed',
    })
  })

  it('anchors task failure audit to the run that supplied the failure reason', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const failed = createRun(task, builder, { terminalState: 'failed', failReason: 'useful failure' })
    const later = createRun(task, builder, { terminalState: 'failed', failReason: null })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled[0]).toMatchObject({
      auditRunId: failed.id,
      reason: 'useful failure',
    })
    expect(fixture.repos.evidence.list(later.id)).toEqual([])
    expectReconcileAudit(failed.id, 'task_failed')
  })

  it('keeps dry-run reconcile read-only and does not write audit records', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      stage: 'done',
      blockedReason: 'waiting',
      pendingApproval: true,
    })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    expect(result.runsReconciled[0]).toMatchObject({ runId: run.id, reason: 'stale_approval' })
    expect(result.runsReconciled[0]?.audit).toBeUndefined()
    expect(fixture.repos.runs.get(run.id)?.pendingApproval).toBe(true)
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('does not duplicate audit records after a repaired state no longer matches', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, {
      stage: 'done',
      pendingApproval: true,
    })

    await reconcileInconsistentRuns(fixture.context)
    const evidenceCount = fixture.repos.evidence.list(run.id).length
    const updateCount = fixture.repos.runUpdates.list(run.id).length

    const second = await reconcileInconsistentRuns(fixture.context)

    expect(second.runsReconciled.find((entry) => entry.runId === run.id)).toBeUndefined()
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(evidenceCount)
    expect(fixture.repos.runUpdates.list(run.id)).toHaveLength(updateCount)
  })

})

function expectReconcileAudit(runId: Run['id'], reason: string) {
  if (fixture == null) throw new Error('test fixture missing')
  const updates = fixture.repos.runUpdates.list(runId)
  expect(updates.at(-1)?.message).toContain(`reconcile ${reason}`)
  const evidence = fixture.repos.evidence.list(runId).at(-1)
  expect(evidence?.type).toBe('custom')
  expect(evidence?.payload).toMatchObject({
    kind: 'state-reconcile',
    reason,
    message: expect.any(String),
    before: expect.any(Object),
    after: expect.any(Object),
  })
  return evidence!
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
