import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('task agent assignment route', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(() => {
    fixture.close()
  })

  it('retargets a task when prior runs are terminal', async () => {
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.runs.create(makeRun(task.id, builder.id, 'ship', 'failed'))

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/agent`, {
      method: 'PUT',
      body: { agentId: reviewer.id },
    })

    expect(response.response.status).toBe(200)
    expect((response.json as Task).assignedAgentId).toBe(reviewer.id)
    expect(fixture.repos.tasks.get(task.id)?.assignedAgentId).toBe(reviewer.id)
  })

  it('rejects retargeting while a run is still live', async () => {
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.runs.create(makeRun(task.id, builder.id, 'implement', null))

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/agent`, {
      method: 'PUT',
      body: { agentId: reviewer.id },
    })

    expect(response.response.status).toBe(409)
    expect((response.json as { error: string }).error).toContain('active run')
    expect(fixture.repos.tasks.get(task.id)?.assignedAgentId).toBe(builder.id)
  })
})

function makeRun(
  taskId: Task['id'],
  agentId: Run['agentId'],
  stage: Run['stage'],
  terminalState: Run['terminalState'],
): Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary'> {
  return {
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage,
    terminalState,
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
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: terminalState == null ? null : 'failed for test',
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-25T01:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
  }
}
