import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory analytics reviewer regressions', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('does not fabricate an aggregate budget cap when the window has no active specs', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z'), costBudget: { perSpecHardUsd: 10 } })
    seedBase(fixture)
    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as {
      budget: { capUsd: number | null; spentUsd: number; remainingUsd: number | null; burnPct: number | null; burnPctLabel: string; bySpec: unknown[] }
    }
    expect(report.budget).toMatchObject({ capUsd: 0, spentUsd: 0, remainingUsd: 0, burnPct: null, burnPctLabel: 'no active specs', bySpec: [] })
  })

  it('redacts and formula-neutralizes CSV label cells', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    fixture.db.prepare('UPDATE agents SET name = ? WHERE id = ?')
      .run('=HYPERLINK("https://example.test","x") sk-test-secret-token', builder.id)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-30T12:00:00.000Z')

    const response = await fixture.app.request('/api/factory/analytics/report?range=7d&format=csv')
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-test-secret-token')
    expect(text).toContain("'=HYPERLINK")
    expect(text).toContain('[redacted]')
  })

  function createRun(task: Task, agentId: Run['agentId'], overrides: Partial<Run>, createdAt: string): Run {
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
