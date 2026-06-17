import { afterEach, describe, expect, it } from 'vitest'

import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
})

describe('RunStateMachine failure cleanup', () => {
  it('keeps clean failure metadata clean when a never-failed run is marked done', () => {
    const { machine, run } = createFixture({ recoverable: true })

    const updated = machine.markDone(run.id, 'completed normally')

    expect(updated.stage).toBe('done')
    expect(updated.terminalState).toBeNull()
    expect(updated.failReason).toBeNull()
    expect(updated.recoverable).toBe(true)
  })

  it('clears stale failure metadata when a run is later marked done', () => {
    const { machine, run } = createFixture({
      terminalState: 'failed',
      blockedReason: 'waiting for approval',
      pendingApproval: true,
      failReason: 'stale failure',
      recoverable: false,
    })

    const updated = machine.markDone(run.id, 'verified and committed')

    expect(updated.stage).toBe('done')
    expect(updated.terminalState).toBeNull()
    expect(updated.blockedReason).toBeNull()
    expect(updated.pendingApproval).toBe(false)
    expect(updated.failReason).toBeNull()
    expect(updated.recoverable).toBe(true)
  })
})

function createFixture(overrides: {
  terminalState?: 'failed' | 'stalled' | null
  blockedReason?: string | null
  pendingApproval?: boolean
  failReason?: string | null
  recoverable?: boolean
}) {
  const context = createRepoContext()
  cleanup.push(context)
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: `task-${ids.taskId}`,
    prompt: 'implement P1',
    repos: ['packages/core'],
    assignedAgentId: builder.id,
    status: 'active',
    verification: ['pnpm test'],
  })
  const run = context.runRepo.create({
    id: ids.runId,
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage: 'ship',
    terminalState: overrides.terminalState ?? null,
    resetCount: 0,
    completedStages: [],
    blockedReason: overrides.blockedReason ?? null,
    pendingApproval: overrides.pendingApproval ?? false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: overrides.failReason ?? null,
    recoverable: overrides.recoverable ?? true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-28T07:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
  const machine = new RunStateMachine(
    context.runRepo,
    context.runStageHistoryRepo,
    new DuctumEventEmitter(),
  )
  return { context, machine, run }
}
