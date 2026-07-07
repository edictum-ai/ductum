import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory analytics status counts', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('counts completion-summary runs as awaiting review instead of running', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder.id, '2026-06-30T12:00:00.000Z')
    fixture.repos.runs.updateCompletionSummary(run.id, 'implementation completed and awaiting routing')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as {
      statusCounts: Record<string, number>
      headline: { statusCounts: Record<string, number> }
    }

    expect(report.statusCounts.awaiting_review).toBe(1)
    expect(report.statusCounts.running).toBe(0)
    expect(report.headline.statusCounts.awaiting_review).toBe(1)
    expect(report.headline.statusCounts.running).toBe(0)
  })

  function createRun(task: Task, agentId: Run['agentId'], createdAt: string): Run {
    const run = fixture!.repos.runs.create({
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
    })
    fixture!.db.prepare('UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?').run(createdAt, createdAt, run.id)
    return run
  }
})
