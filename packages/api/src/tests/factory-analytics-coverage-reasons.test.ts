import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory analytics coverage reasons', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('separates operator-recorded outcomes from scanner misses', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    const operator = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'operator',
      model: 'recorded:operator',
      harness: 'codex-sdk',
      capabilities: [],
      costTier: 0,
      spawnConfig: {},
    })
    createRun(task, builder.id, { stage: 'done' }, '2026-06-30T12:00:00.000Z')
    createRun(task, operator.id, { stage: 'done' }, '2026-06-30T12:01:00.000Z')
    createRun(task, builder.id, { stage: 'done', tokensIn: 100, tokensOut: 50 }, '2026-06-30T12:02:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as Report

    expect(report.missingUsage.totalAttempts).toBe(3)
    expect(report.missingUsage.reasonCounts).toEqual({
      operatorRecorded: 1,
      scannerMissing: 1,
      priceMissing: 1,
    })
    expect(report.missingUsage.rows.map((row) => row.coverageReason).sort()).toEqual([
      'operator_recorded',
      'price_missing',
      'scanner_missing',
    ])
  })

  function createRun(
    task: Task,
    agentId: Run['agentId'],
    overrides: Partial<Run>,
    createdAt: string,
  ): Run {
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
      ...overrides,
    })
    fixture!.db.prepare('UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?').run(createdAt, createdAt, run.id)
    return run
  }
})

interface Report {
  missingUsage: {
    totalAttempts: number
    reasonCounts: { operatorRecorded: number; scannerMissing: number; priceMissing: number }
    rows: Array<{ coverageReason: string }>
  }
}
