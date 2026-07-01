import { createId, type Run } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('operator brief count safety above default run limits', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('counts all active leaf runs above 50', async () => {
    fixture = await createFixture()
    const { builder, spec } = seedBase(fixture)

    for (let index = 0; index < 51; index += 1) {
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: `active-task-${index}`,
        prompt: `active task ${index}`,
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      createRun(task, builder.id, {
        sessionId: `session-${index}`,
        lastHeartbeat: `2026-06-26T12:${String(index).padStart(2, '0')}:00.000Z`,
      })
    }

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.activeRuns).toBe(51)
    expect(brief.queue.approvalsWaiting).toBe(0)
  })

  it('caps needs-operator samples while preserving the full count', async () => {
    fixture = await createFixture()
    const { builder, spec } = seedBase(fixture)

    for (let index = 0; index < 55; index += 1) {
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: `failed-task-${index}`,
        prompt: `failed task ${index}`,
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      createRun(task, builder.id, {
        terminalState: 'failed',
        failReason: `failed ${index}`,
        lastHeartbeat: `2026-06-26T12:${String(index).padStart(2, '0')}:00.000Z`,
      })
    }

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: { needsOperator: number; needsOperatorAttempts: unknown[] } }

    expect(brief.queue.needsOperator).toBe(55)
    expect(brief.queue.needsOperatorAttempts).toHaveLength(50)
  })

  function createRun(
    task: { id: string },
    agentId: Run['agentId'],
    overrides: Partial<Run> = {},
  ): Run {
    return fixture!.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id as Run['taskId'],
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
})
