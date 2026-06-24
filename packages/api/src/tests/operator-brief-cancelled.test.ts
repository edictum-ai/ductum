import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory summary cancelled worktree attention', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('counts a cancelled run with a dirty preserved worktree as needs-operator attention', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, {
      terminalState: 'cancelled',
      worktreePaths: ['/tmp/ductum-cancelled-dirty'],
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'operator.cancel',
        reason: 'operator stopped the run',
        worktreePreserved: true,
        dirtyWorktree: true,
        cleanupAt: null,
        timestamp: new Date().toISOString(),
      },
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number>; recommendedActions: string[] }

    expect(brief.queue.needsOperator).toBe(1)
    expect(brief.recommendedActions.join(' ')).toContain('cancelled')
  })

  it('does not count a cancelled run after worktree cleanup removed preserved state', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, {
      terminalState: 'cancelled',
      worktreePaths: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'operator.cancel',
        reason: 'operator stopped the run and cleaned up',
        worktreePreserved: false,
        dirtyWorktree: true,
        cleanupAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      },
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.needsOperator).toBe(0)
  })

  it('does not count a clean cancelled run even when the worktree was preserved', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, {
      terminalState: 'cancelled',
      worktreePaths: ['/tmp/ductum-cancelled-clean'],
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'operator.cancel',
        reason: 'operator stopped a clean run',
        worktreePreserved: true,
        dirtyWorktree: false,
        cleanupAt: null,
        timestamp: new Date().toISOString(),
      },
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.needsOperator).toBe(0)
  })
})

function createRun(
  fixture: TestFixture,
  task: Task,
  agentId: Run['agentId'],
  overrides: Partial<Run> = {},
): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
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
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}
