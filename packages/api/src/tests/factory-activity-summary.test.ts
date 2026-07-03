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

  it('excludes integrity-flagged done runs from clean done counts', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    const clean = createRun(task, builder.id, {
      stage: 'done',
      sessionId: 'clean-session',
      worktreePaths: ['/tmp/clean-worktree'],
      commitSha: 'abc123',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 10,
    })
    const dirty = createRun(task, builder.id, {
      stage: 'done',
      tokensIn: 100,
      tokensOut: 200,
      costUsd: 5,
    })
    setCreatedAt(clean.id, '2026-06-30T12:00:00.000Z')
    setCreatedAt(dirty.id, '2026-06-30T12:00:00.000Z')

    const response = await requestJson(fixture.app, '/api/factory/activity-summary')
    expect(response.response.status).toBe(200)
    const summary = response.json as {
      allTime: {
        attemptCount: number
        cleanDone: number
        costPerCleanDoneUsd: number | null
        statusCounts: { done: number }
      }
      currentWindow: { cleanDone: number; statusCounts: { done: number } }
    }

    expect(summary.allTime).toMatchObject({
      attemptCount: 2,
      cleanDone: 1,
      statusCounts: { done: 2 },
    })
    expect(summary.allTime.costPerCleanDoneUsd).toBe(15)
    expect(summary.currentWindow).toMatchObject({
      cleanDone: 1,
      statusCounts: { done: 2 },
    })
  })

  it('separates missing usage, missing price, and pending in cost copy and value labels', async () => {
    // Behavior contract #2 (issue #244): the activity summary must not
    // collapse missing usage and missing price into $0, "free", or one
    // ambiguous gap label. Each cost state has its own SQL CASE branch
    // and each gets its own phrase in the issue label.
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    // measured: cost_usd > 0
    const measured = createRun(task, builder.id, {
      stage: 'done', costUsd: 4, tokensIn: 100, tokensOut: 50,
    })
    // missing price: cost_usd = 0 but tokens recorded
    const unpriced = createRun(task, builder.id, {
      stage: 'done', costUsd: 0, tokensIn: 100, tokensOut: 50,
    })
    // missing usage: cost_usd = 0, no tokens, terminal (stage 'done' marks
    // the run as terminal for the missing-usage SQL CASE branch; null is
    // the valid non-terminal value).
    const unmeasured = createRun(task, builder.id, {
      stage: 'done', terminalState: null, costUsd: 0, tokensIn: 0, tokensOut: 0,
    })
    setCreatedAt(measured.id, '2026-06-30T12:00:00.000Z')
    setCreatedAt(unpriced.id, '2026-06-30T12:00:00.000Z')
    setCreatedAt(unmeasured.id, '2026-06-30T12:00:00.000Z')

    const response = await requestJson(fixture.app, '/api/factory/activity-summary')
    expect(response.response.status).toBe(200)
    const summary = response.json as {
      allTime: {
        cost: {
          trackedUsd: number
          measured: number
          pending: number
          missingPrice: number
          missingUsage: number
          valueLabel: string
          issueLabel: string
          hasGap: boolean
        }
      }
    }

    const cost = summary.allTime.cost
    expect(cost.trackedUsd).toBeCloseTo(4, 2)
    expect(cost.measured).toBe(1)
    expect(cost.missingPrice).toBe(1)
    expect(cost.missingUsage).toBe(1)
    expect(cost.hasGap).toBe(true)
    // Tracked spend stays truthful — never collapses to $0 when tokens
    // were recorded but unpriced.
    expect(cost.valueLabel).toBe('$4.00')
    // Each gap kind carries its own phrase.
    expect(cost.issueLabel.toLowerCase()).toContain('missing usage')
    expect(cost.issueLabel.toLowerCase()).toContain('missing price')
    expect(cost.issueLabel.toLowerCase()).not.toContain('free')
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
