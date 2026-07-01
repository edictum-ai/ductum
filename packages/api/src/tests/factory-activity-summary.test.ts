import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('Factory activity summary', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('aggregates cost and counts from all runs instead of the default row cap', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)

    for (let i = 0; i < 60; i += 1) {
      const run = createRun(task, builder.id, {
        stage: 'done',
        tokensIn: 100,
        tokensOut: 200,
        costUsd: 1,
      })
      setCreatedAt(run.id, '2026-06-30T12:00:00.000Z')
    }
    const previous = createRun(task, builder.id, {
      stage: 'done',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 5,
    })
    setCreatedAt(previous.id, '2026-06-20T12:00:00.000Z')

    const cappedRuns = await requestJson(fixture.app, '/api/runs')
    expect((cappedRuns.json as unknown[]).length).toBe(50)

    const response = await requestJson(fixture.app, '/api/factory/activity-summary')
    expect(response.response.status).toBe(200)
    const summary = response.json as {
      source: { attemptCount: number; capped: boolean }
      allTime: { attemptCount: number; cost: { trackedUsd: number }; statusCounts: { done: number } }
      currentWindow: { attemptCount: number; cost: { trackedUsd: number }; statusCounts: { done: number } }
      previousWindow: { attemptCount: number; cost: { trackedUsd: number } }
    }

    expect(summary.source).toMatchObject({ attemptCount: 61, capped: false })
    expect(summary.allTime).toMatchObject({
      attemptCount: 61,
      cost: { trackedUsd: 65 },
      statusCounts: { done: 61 },
    })
    expect(summary.currentWindow).toMatchObject({
      attemptCount: 60,
      cost: { trackedUsd: 60 },
      statusCounts: { done: 60 },
    })
    expect(summary.previousWindow).toMatchObject({
      attemptCount: 1,
      cost: { trackedUsd: 5 },
    })
  })

  function createRun(
    task: Task,
    agentId: Run['agentId'],
    overrides: Partial<Run> = {},
  ): Run {
    return fixture!.repos.runs.create({
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
      lastHeartbeat: '2026-07-01T12:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
      ...overrides,
    })
  }

  function setCreatedAt(runId: Run['id'], createdAt: string) {
    fixture!.db
      .prepare('UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(createdAt, createdAt, runId)
  }
})
