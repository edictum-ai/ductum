import { afterEach, describe, expect, it } from 'vitest'

import { createId, type Run } from '@ductum/core'

import {
  denyTurns,
  extendTurns,
  isMaxTurnsDenied,
  isMaxTurnsPaused,
  isMaxTurnsRecoverable,
} from '../../lib/run-ops/turn-control.js'
import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

let fixture: TestFixture | undefined
afterEach(() => { fixture?.close(); fixture = undefined })

async function makeRunPausedOnMaxTurns(): Promise<{ run: Run; fixture: TestFixture }> {
  const f = await createFixture()
  const { task, builder } = seedBase(f)
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
  // Simulate the dispatcher having marked this run paused on max_turns.
  f.repos.runs.updateFailure(run.id, 'max_turns_paused: hit 200 of 200 agent turns', true)
  f.context.stateMachine.markFailed(run.id, 'max_turns_paused')
  return { run: f.repos.runs.get(run.id) as Run, fixture: f }
}

describe('turn control — extend / deny / paused detection (D118)', () => {
  it('isMaxTurnsPaused / isMaxTurnsDenied recognize the failReason prefixes', () => {
    expect(isMaxTurnsPaused('max_turns_paused: hit 200 of 200')).toBe(true)
    expect(isMaxTurnsPaused('max_turns_denied: not now')).toBe(false)
    expect(isMaxTurnsPaused('cost_budget_paused: …')).toBe(false)
    expect(isMaxTurnsPaused(null)).toBe(false)
    expect(isMaxTurnsRecoverable('max_turns_reached')).toBe(true)
    expect(isMaxTurnsDenied('max_turns_denied: not now')).toBe(true)
    expect(isMaxTurnsDenied('max_turns_paused: …')).toBe(false)
  })

  it('extendTurns bumps the task turn cap, returns task to ready, records evidence', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f

    const result = extendTurns(f.context, { runId: run.id, byCount: 200, reason: 'opus needs more turns' })

    expect(result.ok).toBe(true)
    expect(result.turnExtraCount).toBe(200)
    const task = f.repos.tasks.get(run.taskId)
    expect(task?.turnExtraCount).toBe(200)
    expect(task?.status).toBe('ready')
    const evidence = f.repos.evidence.list(run.id).filter((e) => e.type === 'custom')
    expect(evidence.some((e) => {
      const payload = e.payload as Record<string, unknown>
      return payload.operation === 'turns.extend' && payload.by_count === 200
    })).toBe(true)
  })

  it('extendTurns accepts max_turns_reached failures from silent mid-write exits', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f
    f.repos.runs.updateFailure(run.id, 'max_turns_reached', true)

    const result = extendTurns(f.context, { runId: run.id, byCount: 100, reason: 'mid-write retry' })

    expect(result.ok).toBe(true)
    expect(result.turnExtraCount).toBe(100)
    expect(f.repos.tasks.get(run.taskId)?.status).toBe('ready')
  })

  it('extendTurns refuses non-positive --by values', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f
    expect(() => extendTurns(f.context, { runId: run.id, byCount: 0 })).toThrow(/positive/)
    expect(() => extendTurns(f.context, { runId: run.id, byCount: -10 })).toThrow(/positive/)
    expect(() => extendTurns(f.context, { runId: run.id, byCount: 1.5 })).toThrow(/positive/)
  })

  it('extendTurns refuses runs not paused on max_turns', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
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
    expect(() => extendTurns(fixture!.context, { runId: run.id, byCount: 100 })).toThrow(/not recoverable/)
  })

  it('denyTurns relabels the failReason and records evidence', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f
    const result = denyTurns(f.context, { runId: run.id, reason: 'task superseded' })
    expect(result.ok).toBe(true)
    expect(result.failReason).toBe('max_turns_denied: task superseded')
    expect(isMaxTurnsDenied(f.repos.runs.get(run.id)?.failReason ?? null)).toBe(true)
  })

  it('POST /api/runs/:id/turns-extend round-trips through the route', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f
    const result = await requestJson(f.app, `/api/runs/${run.id}/turns-extend`, {
      method: 'POST',
      body: { by: 100, reason: 'live test' },
    })
    expect(result.response.status).toBe(200)
    const json = result.json as { ok: boolean; turnExtraCount: number }
    expect(json.ok).toBe(true)
    expect(json.turnExtraCount).toBe(100)
  })

  it('POST /api/runs/:id/turns-deny round-trips through the route', async () => {
    const { run, fixture: f } = await makeRunPausedOnMaxTurns()
    fixture = f
    const result = await requestJson(f.app, `/api/runs/${run.id}/turns-deny`, {
      method: 'POST',
      body: { reason: 'route test' },
    })
    expect(result.response.status).toBe(200)
    expect(f.repos.runs.get(run.id)?.failReason).toBe('max_turns_denied: route test')
  })
})
