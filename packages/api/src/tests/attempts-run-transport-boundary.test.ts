import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Attempt facade vs Run transport boundary', () => {
  it('keeps Attempt reads operator-facing while preserving Run transport fields for lifecycle internals', async () => {
    fixture = await createFixture()
    const { project, spec, task, builder } = seedBase(fixture)
    const parentRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: ['understand'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'ductum/failed-attempt',
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum/attempt-parent'],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'verify failed',
      recoverable: true,
      tokensIn: 11,
      tokensOut: 22,
      costUsd: 1.23,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    })
    const childRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: parentRun.id,
      stage: 'ship',
      terminalState: null,
      resetCount: 1,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'ductum/review-attempt',
      commitSha: 'abc123',
      prNumber: 42,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
      worktreePaths: ['/tmp/ductum/attempt-child'],
      ciStatus: 'pass',
      reviewStatus: 'pending',
      failReason: null,
      recoverable: true,
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 3.21,
      lastHeartbeat: '2026-06-20T12:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const attempt = await requestJson(fixture.app, `/api/attempts/${childRun.id}`)
    const run = await requestJson(fixture.app, `/api/runs/${childRun.id}`)

    expect(attempt.json).toMatchObject({
      recordType: 'Attempt',
      id: childRun.id,
      status: 'needs_attention',
      parentAttemptId: parentRun.id,
      pendingApproval: true,
      taskName: task.name,
      specName: spec.name,
      projectName: project.name,
      agentName: builder.name,
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 3.21,
      worktreePaths: ['/tmp/ductum/attempt-child'],
    })
    expect(attempt.json).not.toHaveProperty('parentRunId')
    expect(run.json).toMatchObject({
      id: childRun.id,
      parentRunId: parentRun.id,
      pendingApproval: true,
    })
    expect(run.json).not.toHaveProperty('parentAttemptId')
  })

  it('does not drop task-scoped Attempts that fall outside the global recent-run window', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const oldRun = createRun(fixture, {
      taskId: task.id,
      agentId: builder.id,
      branch: 'ductum/old-task-attempt',
    })

    fixture.db.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', oldRun.id)
    for (let index = 0; index < 55; index += 1) {
      const run = createRun(fixture, {
        taskId: task.id,
        agentId: builder.id,
        branch: `ductum/recent-task-attempt-${index}`,
      })
      fixture.db
        .prepare('UPDATE runs SET created_at = ? WHERE id = ?')
        .run(`2026-02-01T00:${String(index).padStart(2, '0')}:00.000Z`, run.id)
    }

    const taskAttempts = await requestJson(fixture.app, `/api/tasks/${task.id}/attempts`)
    const attempts = (taskAttempts.json as { attempts: Array<{ id: string; parentRunId?: string }> }).attempts

    expect(attempts).toHaveLength(56)
    expect(attempts.some((attempt) => attempt.id === oldRun.id)).toBe(true)
    expect(attempts.some((attempt) => Object.hasOwn(attempt, 'parentRunId'))).toBe(false)
  })
})

function createRun(
  targetFixture: TestFixture,
  fields: {
    taskId: string
    agentId: string
    branch: string
  },
) {
  return targetFixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: fields.taskId as never,
    agentId: fields.agentId as never,
    parentRunId: null,
    stage: 'implement',
    terminalState: 'failed',
    resetCount: 0,
    completedStages: ['understand'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: fields.branch,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: 'historical attempt',
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  })
}
