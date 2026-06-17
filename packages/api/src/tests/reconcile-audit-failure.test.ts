import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

vi.mock('../lib/reconcile-scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reconcile-scan.js')>()
  return {
    ...actual,
    findMergeCommitForRun: vi.fn(async () => 'a'.repeat(40)),
  }
})

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  fixture?.close()
  fixture = undefined
})

describe('reconcile audit failure behavior', () => {
  it('rolls back stale approval repair when evidence audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'done', pendingApproval: true, blockedReason: 'waiting' })
    failEvidenceWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('evidence unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ pendingApproval: true, blockedReason: 'waiting' })
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rolls back merged-run repair when evidence audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'ship', branch: 'feature/x' })
    failEvidenceWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('evidence unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'ship', terminalState: null })
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
  })

  it('rolls back merged ancestor repairs when an audit fails mid-lineage', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const grandparent = createRun(task, builder, { stage: 'ship' })
    const parent = createRun(task, builder, { parentRunId: grandparent.id, stage: 'ship' })
    const child = createRun(task, builder, { parentRunId: parent.id, stage: 'ship', branch: 'feature/x' })
    failSecondEvidenceWrite()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('second evidence unavailable')

    expect(fixture.repos.runs.get(child.id)).toMatchObject({ stage: 'ship', terminalState: null })
    expect(fixture.repos.runs.get(parent.id)).toMatchObject({ stage: 'ship', terminalState: null })
    expect(fixture.repos.runs.get(grandparent.id)).toMatchObject({ stage: 'ship', terminalState: null })
    expect(fixture.repos.runUpdates.list(parent.id)).toEqual([])
    expect(fixture.repos.runUpdates.list(grandparent.id)).toEqual([])
    expect(fixture.repos.evidence.list(parent.id)).toEqual([])
    expect(fixture.repos.evidence.list(grandparent.id)).toEqual([])
  })

  it('rolls back approval-lineage repair when evidence audit fails', async () => {
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
    failEvidenceWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('evidence unavailable')

    expect(fixture.repos.runs.get(fixRun.id)?.stage).toBe('implement')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('active')
    expect(fixture.repos.runUpdates.list(fixRun.id)).toEqual([])
  })

  it('rolls back orphaned-run repair when evidence audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { lastHeartbeat: new Date(Date.now() - 7200_000).toISOString() })
    failEvidenceWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('evidence unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ terminalState: null, failReason: null })
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
  })

  it('rolls back active task repair when evidence audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(task, builder, { terminalState: 'failed', failReason: 'attempt failed' })
    failEvidenceWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('evidence unavailable')

    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.runUpdates.list(run.id)).toEqual([])
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rolls back stale approval repair when run update audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'done', pendingApproval: true, blockedReason: 'waiting' })
    failRunUpdateWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('run updates unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ pendingApproval: true, blockedReason: 'waiting' })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rolls back merged-run repair when run update audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'ship', branch: 'feature/x' })
    failRunUpdateWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('run updates unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'ship', terminalState: null })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rolls back approval-lineage repair when run update audit fails', async () => {
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
    failRunUpdateWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('run updates unavailable')

    expect(fixture.repos.runs.get(fixRun.id)?.stage).toBe('implement')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('active')
    expect(fixture.repos.evidence.list(fixRun.id)).toEqual([])
  })

  it('rolls back orphaned-run repair when run update audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { lastHeartbeat: new Date(Date.now() - 7200_000).toISOString() })
    failRunUpdateWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('run updates unavailable')

    expect(fixture.repos.runs.get(run.id)).toMatchObject({ terminalState: null, failReason: null })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rolls back active task repair when run update audit fails', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(task, builder, { terminalState: 'failed', failReason: 'attempt failed' })
    failRunUpdateWrites()

    await expect(reconcileInconsistentRuns(fixture.context)).rejects.toThrow('run updates unavailable')

    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('reports side-effect audit failure after the primary repair commits', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder, { stage: 'ship', branch: 'feature/x' })
    vi.spyOn(fixture.context.dag, 'onRunComplete').mockImplementation(() => {
      throw new Error('dag unavailable')
    })
    failSecondEvidenceWrite()

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.sideEffectFailures).toEqual([])
    expect(result.sideEffectAuditFailures).toEqual([expect.objectContaining({
      runId: run.id,
      operation: 'dag.onRunComplete',
      error: 'dag unavailable',
      auditError: 'second evidence unavailable',
    })])
    expect(fixture.repos.runs.get(run.id)?.stage).toBe('done')
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(1)
    expect(fixture.repos.evidence.list(run.id)[0]?.payload).toMatchObject({ reason: 'merged' })
    expect(fixture.repos.runUpdates.list(run.id).map((update) => update.message)).not.toContainEqual(
      expect.stringContaining('side_effect_failure'),
    )
  })
})

function failEvidenceWrites(): void {
  if (fixture == null) throw new Error('test fixture missing')
  vi.spyOn(fixture.context.repos.evidence, 'create').mockImplementation(() => {
    throw new Error('evidence unavailable')
  })
}

function failSecondEvidenceWrite(): void {
  if (fixture == null) throw new Error('test fixture missing')
  const original = fixture.context.repos.evidence.create.bind(fixture.context.repos.evidence)
  let calls = 0
  vi.spyOn(fixture.context.repos.evidence, 'create').mockImplementation((input) => {
    calls += 1
    if (calls === 2) throw new Error('second evidence unavailable')
    return original(input)
  })
}

function failRunUpdateWrites(): void {
  if (fixture == null) throw new Error('test fixture missing')
  vi.spyOn(fixture.context.repos.runUpdates, 'create').mockImplementation(() => {
    throw new Error('run updates unavailable')
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
