import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

vi.mock('../lib/reconcile-scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reconcile-scan.js')>()
  return {
    ...actual,
    findMergeCommitForRun: vi.fn(async () => 'b'.repeat(40)),
  }
})

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  fixture?.close()
  fixture = undefined
})

describe('reconcile audit coverage', () => {
  it('does not duplicate merged run or ancestor audit records on a second reconcile', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const parent = createRun(task, builder, { stage: 'ship' })
    const child = createRun(task, builder, { parentRunId: parent.id, stage: 'ship', branch: 'feature/x' })

    const first = await reconcileInconsistentRuns(fixture.context)
    const childEvidence = fixture.repos.evidence.list(child.id).length
    const parentEvidence = fixture.repos.evidence.list(parent.id).length

    const second = await reconcileInconsistentRuns(fixture.context)

    expect(first.runsReconciled.find((entry) => entry.runId === child.id)?.ancestorAudits?.[0]?.runId).toBe(parent.id)
    expect(second.runsReconciled.find((entry) => entry.runId === child.id)).toBeUndefined()
    expect(fixture.repos.evidence.list(child.id)).toHaveLength(childEvidence)
    expect(fixture.repos.evidence.list(parent.id)).toHaveLength(parentEvidence)
  })

  it('does not duplicate task-failed audit records on a second reconcile', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(task, builder, { terminalState: 'failed', failReason: 'terminal failure' })

    const first = await reconcileInconsistentRuns(fixture.context)
    const evidenceCount = fixture.repos.evidence.list(run.id).length
    const second = await reconcileInconsistentRuns(fixture.context)

    expect(first.tasksReconciled[0]?.auditRunId).toBe(run.id)
    expect(second.tasksReconciled).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(evidenceCount)
  })

  it('does not duplicate orphaned audit records on a second reconcile', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { lastHeartbeat: new Date(Date.now() - 7200_000).toISOString() })

    await reconcileInconsistentRuns(fixture.context)
    const evidenceCount = fixture.repos.evidence.list(run.id).length
    const second = await reconcileInconsistentRuns(fixture.context)

    expect(second.runsReconciled.find((entry) => entry.runId === run.id)).toBeUndefined()
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(evidenceCount)
  })

  it('does not duplicate approval-lineage audit records on a second reconcile', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    const root = createRun(task, builder, { stage: 'ship', pendingApproval: true })
    const fixTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-rest-api',
      prompt: 'fix',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const fixRun = createRun(fixTask, builder, { parentRunId: root.id, stage: 'implement' })

    await reconcileInconsistentRuns(fixture.context)
    const evidenceCount = fixture.repos.evidence.list(fixRun.id).length
    const second = await reconcileInconsistentRuns(fixture.context)

    expect(second.runsReconciled.find((entry) => entry.runId === fixRun.id)).toBeUndefined()
    expect(fixture.repos.evidence.list(fixRun.id)).toHaveLength(evidenceCount)
  })

  it('reports merged ancestor effects during dry-run without writing audit records', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const parent = createRun(task, builder, { stage: 'ship' })
    const child = createRun(task, builder, { parentRunId: parent.id, stage: 'ship', branch: 'feature/x' })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    const childEntry = result.runsReconciled.find((entry) => entry.runId === child.id)
    expect(childEntry?.ancestorsMarkedDone).toContain(parent.id)
    expect(childEntry?.audit).toBeUndefined()
    expect(fixture.repos.runs.get(child.id)?.stage).toBe('ship')
    expect(fixture.repos.evidence.list(child.id)).toEqual([])
    expect(fixture.repos.evidence.list(parent.id)).toEqual([])
  })

  it('keeps approval-lineage dry-run read-only', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    const root = createRun(task, builder, { stage: 'ship', pendingApproval: true })
    const fixTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-rest-api',
      prompt: 'fix',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const fixRun = createRun(fixTask, builder, { parentRunId: root.id, stage: 'implement' })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    const entry = result.runsReconciled.find((item) => item.runId === fixRun.id)
    expect(entry?.reason).toBe('approval_lineage')
    expect(entry?.audit).toBeUndefined()
    expect(fixture.repos.runs.get(fixRun.id)?.stage).toBe('implement')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('active')
    expect(fixture.repos.evidence.list(fixRun.id)).toEqual([])
  })

  it('keeps orphaned and task-failed dry-run read-only', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    const orphan = createRun(task, builder, { lastHeartbeat: new Date(Date.now() - 7200_000).toISOString() })
    const failedTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'terminal-task',
      prompt: 'terminal',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const failedRun = createRun(failedTask, builder, { terminalState: 'failed', failReason: 'terminal failure' })

    const result = await reconcileInconsistentRuns(fixture.context, { dryRun: true })

    const orphanEntry = result.runsReconciled.find((entry) => entry.runId === orphan.id)
    expect(orphanEntry?.reason).toBe('orphaned')
    expect(orphanEntry?.audit).toBeUndefined()
    expect(result.tasksReconciled[0]?.taskId).toBe(failedTask.id)
    expect(result.tasksReconciled[0]?.audit).toBeUndefined()
    expect(fixture.repos.runs.get(orphan.id)?.terminalState).toBeNull()
    expect(fixture.repos.tasks.get(failedTask.id)?.status).toBe('active')
    expect(fixture.repos.evidence.list(orphan.id)).toEqual([])
    expect(fixture.repos.evidence.list(failedRun.id)).toEqual([])
  })

  it('uses a visible fallback reason when failed runs have empty failReason strings', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder, { terminalState: 'failed', failReason: '' })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.tasksReconciled[0]?.reason).toBe('all runs terminal')
  })

  it('records side-effect failures after a committed reconcile repair', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'ship', branch: 'feature/x' })
    vi.spyOn(fixture.context.dag, 'onRunComplete').mockImplementation(() => {
      throw new Error('dag unavailable')
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    const payloads = fixture.repos.evidence.list(run.id).map((evidence) => evidence.payload)
    expect(result.sideEffectFailures).toEqual([expect.objectContaining({
      runId: run.id,
      operation: 'dag.onRunComplete',
      error: 'dag unavailable',
      audit: expect.objectContaining({ evidenceId: expect.any(String) }),
    })])
    expect(payloads).toContainEqual(expect.objectContaining({
      kind: 'state-reconcile',
      reason: 'side_effect_failure',
      operation: 'dag.onRunComplete',
      error: 'dag unavailable',
    }))
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toContain('side_effect_failure')
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toContain('dag unavailable')

    const evidenceCount = fixture.repos.evidence.list(run.id).length
    const second = await reconcileInconsistentRuns(fixture.context)
    expect(second.sideEffectFailures).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(evidenceCount)
  })

  it('records distinct audit entries when both completion side effects fail', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'ship', branch: 'feature/x' })
    vi.spyOn(fixture.context.dag, 'onRunComplete').mockImplementation(() => {
      throw new Error('dag unavailable')
    })
    vi.spyOn(fixture.context.enforcement, 'disposeRuntime').mockImplementation(() => {
      throw new Error('runtime disposal unavailable')
    })

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.sideEffectFailures).toEqual([
      expect.objectContaining({ runId: run.id, operation: 'dag.onRunComplete', error: 'dag unavailable' }),
      expect.objectContaining({
        runId: run.id,
        operation: 'enforcement.disposeRuntime',
        error: 'runtime disposal unavailable',
      }),
    ])
    const payloads = fixture.repos.evidence.list(run.id).map((evidence) => evidence.payload)
    expect(payloads).toContainEqual(expect.objectContaining({
      reason: 'side_effect_failure',
      operation: 'dag.onRunComplete',
    }))
    expect(payloads).toContainEqual(expect.objectContaining({
      reason: 'side_effect_failure',
      operation: 'enforcement.disposeRuntime',
    }))
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
