import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { reconcileInconsistentRuns } from '../lib/reconcile.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'

vi.mock('../lib/reconcile-scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reconcile-scan.js')>()
  return {
    ...actual,
    findMergeCommitForRun: vi.fn(async () => 'c'.repeat(40)),
  }
})

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  fixture?.close()
  fixture = undefined
})

describe('reconcile side-effect audit failures', () => {
  it('preserves original side-effect errors and continues the committed repair batch', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const parent = createRun(task, builder, { stage: 'ship' })
    const child = createRun(task, builder, { parentRunId: parent.id, stage: 'ship', branch: 'feature/x' })
    const dagSpy = vi.spyOn(fixture.context.dag, 'onRunComplete').mockImplementation((runId) => {
      throw new Error(`dag unavailable for ${String(runId).slice(0, 8)}`)
    })
    failEvidenceWritesAfter(3)

    const result = await reconcileInconsistentRuns(fixture.context)

    expect(result.sideEffectFailures).toEqual([expect.objectContaining({
      runId: child.id,
      operation: 'dag.onRunComplete',
      error: `dag unavailable for ${child.id.slice(0, 8)}`,
    })])
    expect(result.sideEffectAuditFailures).toEqual([expect.objectContaining({
      runId: parent.id,
      operation: 'dag.onRunComplete',
      error: `dag unavailable for ${parent.id.slice(0, 8)}`,
      auditError: 'evidence unavailable',
    })])
    expect(dagSpy).toHaveBeenCalledWith(child.id)
    expect(dagSpy).toHaveBeenCalledWith(parent.id)
    expect(fixture.repos.runs.get(child.id)?.stage).toBe('done')
    expect(fixture.repos.runs.get(parent.id)?.stage).toBe('done')
    const payloads = [
      ...fixture.repos.evidence.list(child.id),
      ...fixture.repos.evidence.list(parent.id),
    ].map((evidence) => evidence.payload)
    expect(payloads).toContainEqual(expect.objectContaining({ reason: 'merged' }))
    expect(payloads).toContainEqual(expect.objectContaining({
      reason: 'side_effect_failure',
      operation: 'dag.onRunComplete',
      error: `dag unavailable for ${child.id.slice(0, 8)}`,
    }))
  })
})

function failEvidenceWritesAfter(allowedWrites: number): void {
  if (fixture == null) throw new Error('test fixture missing')
  const original = fixture.context.repos.evidence.create.bind(fixture.context.repos.evidence)
  let calls = 0
  vi.spyOn(fixture.context.repos.evidence, 'create').mockImplementation((input) => {
    calls += 1
    if (calls > allowedWrites) throw new Error('evidence unavailable')
    return original(input)
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
