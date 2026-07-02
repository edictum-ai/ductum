import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory analytics', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('honors a 7d default range and labels the window in every headline', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-30T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics')).json as AnalyticsReportShape

    expect(report.range.kind).toBe('7d')
    expect(report.range.label).toBe('Last 7 days')
    expect(report.range.from).toBe('2026-06-24T12:00:00.000Z')
    expect(report.range.to).toBe('2026-07-01T12:00:00.000Z')
    expect(report.range.bucket).toBe('day')
    expect(report.source.capped).toBe(false)
    expect(report.source.coverageLabel.toLowerCase()).toContain('sql count(*) over last 7 days (utc)')
    expect(report.headline.attemptCount).toBe(1)
    expect(report.statusCounts.done).toBe(1)
  })

  it('propagates range=30d, range=90d, range=all to the window', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-15T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-04-15T12:00:00.000Z')

    const r30 = (await requestJson(fixture.app, '/api/factory/analytics?range=30d')).json as AnalyticsReportShape
    expect(r30.range.kind).toBe('30d')
    expect(r30.range.bucket).toBe('day')

    const r90 = (await requestJson(fixture.app, '/api/factory/analytics?range=90d')).json as AnalyticsReportShape
    expect(r90.range.kind).toBe('90d')
    expect(r90.range.bucket).toBe('week')

    const rAll = (await requestJson(fixture.app, '/api/factory/analytics?range=all')).json as AnalyticsReportShape
    expect(rAll.range.kind).toBe('all')
    expect(rAll.range.from).toBeNull()
    expect(rAll.range.bucket).toBe('month')
    expect(rAll.headline.attemptCount).toBe(2)
  })

  it('clamps custom range `to` to now and rejects inverted windows', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-30T12:00:00.000Z')

    const future = (await requestJson(
      fixture.app,
      '/api/factory/analytics?range=custom&to=2030-01-01T00:00:00.000Z',
    )).json as AnalyticsReportShape
    expect(future.range.to).toBe('2026-07-01T12:00:00.000Z')

    const inverted = (await requestJson(
      fixture.app,
      '/api/factory/analytics?range=custom&from=2026-07-01T00:00:00.000Z&to=2026-06-25T00:00:00.000Z',
    )).json as AnalyticsReportShape
    expect(Date.parse(inverted.range.to)).toBeGreaterThan(Date.parse(inverted.range.from!))
  })

  it('keeps aggregate trend totals consistent with headline counts', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    for (let i = 0; i < 5; i += 1) {
      createRun(task, builder.id, { stage: 'done', costUsd: 1, tokensOut: 100 }, '2026-06-30T12:00:00.000Z')
    }
    for (let i = 0; i < 2; i += 1) {
      createRun(task, builder.id, { stage: 'implement', terminalState: 'failed', costUsd: 0.5 }, '2026-06-29T12:00:00.000Z')
    }

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    expect(report.trends.attemptsTotal).toBe(report.headline.attemptCount)
    expect(report.trends.spendTotalUsd).toBeCloseTo(report.headline.cost.trackedUsd, 2)
    expect(report.trends.failuresTotal).toBe(report.headline.statusCounts.failed)
    expect(report.trends.buckets.length).toBeGreaterThan(0)
    const sumAttempts = report.trends.buckets.reduce((s, b) => s + b.attempts, 0)
    expect(sumAttempts).toBe(report.headline.attemptCount)
  })

  it('keeps 90d weekly trend buckets aligned with SQL group keys', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-17T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-24T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=90d')).json as AnalyticsReportShape
    expect(report.range.bucket).toBe('week')
    expect(report.trends.attemptsTotal).toBe(2)
    expect(report.trends.buckets.some((bucket) => bucket.attempts > 0)).toBe(true)
  })

  it('groups per-agent and per-model breakdowns with success rate and cost per clean', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, cleanDone({ costUsd: 4, tokensOut: 10 }, 'clean-session-1'), '2026-06-30T12:00:00.000Z')
    createRun(task, builder.id, cleanDone({ costUsd: 2, tokensOut: 10 }, 'clean-session-2'), '2026-06-30T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'implement', terminalState: 'failed' }, '2026-06-30T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    expect(report.perAgent.length).toBe(1)
    const agentRow = report.perAgent[0]!
    expect(agentRow.attemptCount).toBe(3)
    expect(agentRow.cleanDone).toBe(2)
    expect(agentRow.costPerCleanDoneUsd).toBeCloseTo(3, 2)
    expect(agentRow.successRateLabel).toMatch(/67%/)

    expect(report.perModel.length).toBeGreaterThanOrEqual(1)
    const modelRow = report.perModel[0]!
    expect(modelRow.label).toBe(builder.model)
    expect(modelRow.cleanDone).toBe(2)
  })

  it('uses execution-integrity-clean done consistently across headline trends and breakdowns', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, cleanDone({ costUsd: 10 }, 'clean-session'), '2026-06-30T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'done', costUsd: 5 }, '2026-06-30T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    expect(report.headline.statusCounts.done).toBe(2)
    expect(report.headline.cleanDone).toBe(1)
    expect(report.headline.costPerCleanDoneUsd).toBe(15)
    expect(report.trends.cleanDoneTotal).toBe(1)
    expect(report.perAgent[0]!.doneCount).toBe(2)
    expect(report.perAgent[0]!.cleanDone).toBe(1)
    expect(report.perAgent[0]!.successRateLabel).toMatch(/50%/)
    expect(report.perModel[0]!.cleanDone).toBe(1)
  })

  it('labels known spend, usage missing, and price missing distinctly in cost copy', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 5, tokensOut: 100 }, '2026-06-30T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'done', tokensIn: 100, tokensOut: 50, costUsd: 0 }, '2026-06-30T12:00:00.000Z')
    createRun(task, builder.id, { stage: 'done', tokensIn: 0, tokensOut: 0, costUsd: 0 }, '2026-06-30T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    const cost = report.headline.cost
    expect(cost.trackedUsd).toBeCloseTo(5, 2)
    expect(cost.measured).toBe(1)
    expect(cost.missingPrice).toBe(1)
    expect(cost.missingUsage).toBe(1)
    expect(cost.issueLabel.toLowerCase()).toContain('missing usage')
    expect(cost.issueLabel.toLowerCase()).toContain('missing price')
    expect(cost.dominantCoverage).toBe('usage_missing')
  })

  it('exposes the missing-usage filter with a server-authoritative total count', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    for (let i = 0; i < 3; i += 1) {
      createRun(task, builder.id, { stage: 'done' }, '2026-06-30T12:00:00.000Z')
    }
    createRun(task, builder.id, { stage: 'done', tokensIn: 100, tokensOut: 50, costUsd: 0 }, '2026-06-30T12:00:00.000Z')

    const usageReport = (await requestJson(
      fixture.app,
      '/api/factory/analytics?range=7d&missingUsage=usage_missing',
    )).json as AnalyticsReportShape
    expect(usageReport.missingUsage.coverageKind).toBe('usage_missing')
    expect(usageReport.missingUsage.totalAttempts).toBe(3)
    expect(usageReport.missingUsage.rows.length).toBe(3)
    expect(usageReport.missingUsage.rowsCapped).toBe(false)

    const priceReport = (await requestJson(
      fixture.app,
      '/api/factory/analytics?range=7d&missingUsage=price_missing',
    )).json as AnalyticsReportShape
    expect(priceReport.missingUsage.coverageKind).toBe('price_missing')
    expect(priceReport.missingUsage.totalAttempts).toBe(1)
    expect(priceReport.missingUsage.rows.length).toBe(1)

    const anyReport = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    expect(anyReport.missingUsage.coverageKind).toBe('any_gap')
    expect(anyReport.missingUsage.totalAttempts).toBe(4)
  })

  it('renders budget burn-down against the configured perSpecHardUsd cap', async () => {
    fixture = await createFixture({
      now: () => new Date('2026-07-01T12:00:00.000Z'),
      costBudget: { perSpecHardUsd: 10 },
    })
    const { project, task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 6 }, '2026-06-30T12:00:00.000Z')
    const secondSpec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'P5',
      status: 'approved',
      document: '# P5',
    })
    const secondTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: secondSpec.id,
      name: 'Dashboard',
      prompt: 'implement P5',
      repos: ['packages/dashboard'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: ['pnpm test'],
    })
    createRun(secondTask, builder.id, { stage: 'done', costUsd: 6 }, '2026-06-30T12:00:00.000Z')

    const report = (await requestJson(fixture.app, '/api/factory/analytics?range=7d')).json as AnalyticsReportShape
    expect(report.budget).not.toBeNull()
    expect(report.budget!.capUsd).toBe(20)
    expect(report.budget!.spentUsd).toBeCloseTo(12, 2)
    expect(report.budget!.remainingUsd).toBeCloseTo(8, 2)
    expect(report.budget!.burnPct).toBeCloseTo(0.6, 2)
    expect(report.budget!.bySpec.length).toBe(2)
    expect(report.budget!.bySpec.map((row) => row.specName).sort()).toEqual(['P4', 'P5'])
  })

  it('exports a CSV report via /report?format=csv', async () => {
    fixture = await createFixture({ now: () => new Date('2026-07-01T12:00:00.000Z') })
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, { stage: 'done', costUsd: 1 }, '2026-06-30T12:00:00.000Z')

    const response = await fixture.app.request('/api/factory/analytics/report?range=7d&format=csv')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/csv/)
    const text = await response.text()
    expect(text).toContain('# ductum factory analytics report')
    expect(text).toContain('section,key,label')
    expect(text).toContain('trend,')
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
    fixture!.db
      .prepare('UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(createdAt, createdAt, run.id)
    return run
  }

  function cleanDone(overrides: Partial<Run>, sessionId: string): Partial<Run> {
    return {
      stage: 'done', sessionId, worktreePaths: [`/tmp/${sessionId}`], commitSha: `${sessionId}-commit`,
      ...overrides,
    }
  }
})

interface AnalyticsReportShape {
  range: { kind: string; label: string; from: string | null; to: string; days: number | null; bucket: string }
  source: { capped: boolean; coverageLabel: string }
  statusCounts: Record<string, number>
  headline: {
    attemptCount: number; statusCounts: Record<string, number>; cleanDone: number; costPerCleanDoneUsd: number | null
    cost: { trackedUsd: number; measured: number; missingPrice: number; missingUsage: number; issueLabel: string; dominantCoverage: string; hasGap: boolean }
  }
  trends: { attemptsTotal: number; spendTotalUsd: number; failuresTotal: number; cleanDoneTotal: number; buckets: Array<{ attempts: number; spendUsd: number }> }
  perAgent: Array<{ attemptCount: number; doneCount: number; cleanDone: number; costPerCleanDoneUsd: number | null; successRateLabel: string }>
  perModel: Array<{ label: string; cleanDone: number }>
  budget: { capUsd: number | null; spentUsd: number; remainingUsd: number | null; burnPct: number | null; bySpec: Array<{ specName: string }> } | null; missingUsage: { coverageKind: string; totalAttempts: number; rows: unknown[]; rowsCapped: boolean }
}
