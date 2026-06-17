import { afterEach, describe, expect, it } from 'vitest'

import { createId, type Run } from '@ductum/core'

import { enforceCostBudget } from '../../lib/run-ops/cost-budget.js'
import { denyBudget, extendBudget, isBudgetDenied, isBudgetPaused } from '../../lib/run-ops/budget-control.js'
import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

let fixture: TestFixture | undefined
afterEach(() => { fixture?.close(); fixture = undefined })

async function makeRunPausedAtCap(usd = 30): Promise<{ run: Run; fixture: TestFixture }> {
  const f = await createFixture({ costBudget: { perRunHardUsd: usd } })
  const { task, builder } = seedBase(f)
  f.context.killRun = async () => undefined
  const run = f.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: builder.id,
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
  })
  f.repos.runs.updateTokens(run.id, 0, 0, usd + 0.01)
  await enforceCostBudget(f.context, run.id)
  return { run: f.repos.runs.get(run.id) as Run, fixture: f }
}

describe('budget control — extend / deny / paused detection', () => {
  it('isBudgetPaused / isBudgetDenied recognize the failReason prefixes', () => {
    expect(isBudgetPaused('cost_budget_paused: $30 >= $30')).toBe(true)
    expect(isBudgetPaused('spec_cost_budget_paused: …')).toBe(true)
    expect(isBudgetPaused('cost_budget_denied: operator said no')).toBe(false)
    expect(isBudgetPaused('Retried by operator')).toBe(false)
    expect(isBudgetPaused(null)).toBe(false)
    expect(isBudgetDenied('cost_budget_denied: operator said no')).toBe(true)
    expect(isBudgetDenied('cost_budget_paused: …')).toBe(false)
    expect(isBudgetDenied(null)).toBe(false)
  })

  it('extendBudget bumps the task cap, returns task to ready, records evidence', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f
    expect(isBudgetPaused(run.failReason)).toBe(true)

    const result = extendBudget(f.context, { runId: run.id, byUsd: 50, reason: 'opus needs more runway' })

    expect(result.ok).toBe(true)
    expect(result.budgetExtraUsd).toBe(50)
    const task = f.repos.tasks.get(run.taskId)
    expect(task?.budgetExtraUsd).toBe(50)
    expect(task?.status).toBe('ready')
    const evidence = f.repos.evidence.list(run.id).filter((e) => e.type === 'custom')
    expect(evidence.some((e) => {
      const payload = e.payload as Record<string, unknown>
      return payload.operation === 'budget.extend' && payload.by_usd === 50
    })).toBe(true)
  })

  it('extendBudget refuses when run is not paused on a cost budget', async () => {
    fixture = await createFixture({ costBudget: { perRunHardUsd: 30 } })
    const { task, builder } = fixture && seedBase(fixture)!
    const run = fixture!.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
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
    })
    expect(() => extendBudget(fixture!.context, { runId: run.id, byUsd: 10 })).toThrow(/not paused/)
  })

  it('extendBudget refuses non-positive byUsd', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f
    expect(() => extendBudget(f.context, { runId: run.id, byUsd: 0 })).toThrow(/positive/)
    expect(() => extendBudget(f.context, { runId: run.id, byUsd: -5 })).toThrow(/positive/)
    expect(() => extendBudget(f.context, { runId: run.id, byUsd: Number.NaN })).toThrow(/positive/)
  })

  it('denyBudget relabels the failReason and records evidence', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f

    const result = denyBudget(f.context, { runId: run.id, reason: 'P3 superseded by V2' })

    expect(result.ok).toBe(true)
    expect(result.failReason).toBe('cost_budget_denied: P3 superseded by V2')
    const after = f.repos.runs.get(run.id)
    expect(isBudgetDenied(after?.failReason ?? null)).toBe(true)
    expect(after?.recoverable).toBe(false)
    const evidence = f.repos.evidence.list(run.id).filter((e) => e.type === 'custom')
    expect(evidence.some((e) => (e.payload as Record<string, unknown>).operation === 'budget.deny')).toBe(true)
  })

  it('denyBudget refuses empty reason', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f
    expect(() => denyBudget(f.context, { runId: run.id, reason: '   ' })).toThrow(/reason/)
  })

  it('budget cap honors task.budgetExtraUsd in subsequent runs', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f
    extendBudget(f.context, { runId: run.id, byUsd: 100, reason: 'continue' })

    // Simulate a fresh run for the same task. Effective cap is now $130.
    const fresh = f.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: run.taskId,
      agentId: run.agentId,
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
    })

    // At $50 — under the new $130 effective cap. No pause.
    f.repos.runs.updateTokens(fresh.id, 0, 0, 50)
    let paused = await enforceCostBudget(f.context, fresh.id)
    expect(paused).toBe(false)
    expect(f.repos.runs.get(fresh.id)?.terminalState).toBeNull()

    // At $130.01 — over the effective cap. Pauses now.
    f.repos.runs.updateTokens(fresh.id, 0, 0, 130.01)
    paused = await enforceCostBudget(f.context, fresh.id)
    expect(paused).toBe(true)
    expect(isBudgetPaused(f.repos.runs.get(fresh.id)?.failReason ?? null)).toBe(true)
  })

  it('POST /api/runs/:id/budget-extend round-trips through the route', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f

    const result = await requestJson(f.app, `/api/runs/${run.id}/budget-extend`, {
      method: 'POST',
      body: { by: 25, reason: 'live test' },
    })

    expect(result.response.status).toBe(200)
    const json = result.json as { ok: boolean; budgetExtraUsd: number }
    expect(json.ok).toBe(true)
    expect(json.budgetExtraUsd).toBe(25)
  })

  it('POST /api/runs/:id/budget-deny round-trips through the route', async () => {
    const { run, fixture: f } = await makeRunPausedAtCap(30)
    fixture = f

    const result = await requestJson(f.app, `/api/runs/${run.id}/budget-deny`, {
      method: 'POST',
      body: { reason: 'route test' },
    })

    expect(result.response.status).toBe(200)
    expect(f.repos.runs.get(run.id)?.failReason).toBe('cost_budget_denied: route test')
  })
})
