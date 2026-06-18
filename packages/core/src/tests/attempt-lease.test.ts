import { afterEach, describe, expect, it } from 'vitest'

import { createId } from '../types.js'
import { applyMigration, MIGRATIONS } from '../db-migrations.js'
import { buildCheckpointInput } from '../run-checkpoint.js'
import { StaleFenceError } from '../attempt-lease.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'

let context: ReturnType<typeof createRepoContext> | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

function seedRun() {
  context = createRepoContext()
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: 'lease-test',
    prompt: 'implement',
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
    stage: 'understand',
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
    lastHeartbeat: '2026-04-04T10:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
  return { context, run }
}

describe('AttemptLease fencing', () => {
  it('creates the durable lease schema idempotently', () => {
    context = createRepoContext()
    const migration = MIGRATIONS.find((item) => item.id === '044_attempt_leases')!
    applyMigration(context.db, migration)

    expect(context.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attempt_leases'").get()).toBeTruthy()
    expect(context.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attempt_fence_sequence'").get()).toBeTruthy()
    expect(context.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_attempt_leases_active_run'").get()).toBeTruthy()
  })

  it('allocates monotonic fence tokens across released attempts', () => {
    const { context, run } = seedRun()
    const now = new Date('2026-04-04T10:00:00.000Z')
    const first = context.attemptLeaseRepo.acquire({
      attemptId: 'attempt-1',
      runId: run.id,
      sessionId: 'session-1',
      ownerProcessId: 'process-1',
      ttlMs: 60_000,
      now,
    })

    context.attemptLeaseRepo.release({ runId: run.id, fenceToken: first.fenceToken, now })
    const second = context.attemptLeaseRepo.acquire({
      attemptId: 'attempt-2',
      runId: run.id,
      sessionId: 'session-2',
      ownerProcessId: 'process-2',
      ttlMs: 60_000,
      now: new Date('2026-04-04T10:01:00.000Z'),
    })

    expect(second.fenceToken).toBeGreaterThan(first.fenceToken)
    expect(context.attemptLeaseRepo.getLatestForRun(run.id)?.attemptId).toBe('attempt-2')
  })

  it('rejects stale fenced terminal, checkpoint, evidence, and cost writes', () => {
    const { context, run } = seedRun()
    const now = new Date('2026-04-04T10:00:00.000Z')
    const stale = context.attemptLeaseRepo.acquire({
      attemptId: 'attempt-1',
      runId: run.id,
      sessionId: 'session-1',
      ownerProcessId: 'process-1',
      ttlMs: 60_000,
      now,
    })
    context.attemptLeaseRepo.release({ runId: run.id, fenceToken: stale.fenceToken, now })
    const current = context.attemptLeaseRepo.acquire({
      attemptId: 'attempt-2',
      runId: run.id,
      sessionId: 'session-2',
      ownerProcessId: 'process-2',
      ttlMs: 60_000,
      now: new Date('2026-04-04T10:01:00.000Z'),
    })

    const leaseNow = new Date('2026-04-04T10:01:00.000Z')
    expect(() => context.runRepo.updateTerminalStateFenced(run.id, 'stalled', stale.fenceToken, leaseNow)).toThrow(StaleFenceError)
    expect(() => context.runCheckpointRepo.upsertFenced(buildCheckpointInput(run, 'implement'), stale.fenceToken, leaseNow)).toThrow(StaleFenceError)
    expect(() => context.evidenceRepo.createFenced({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { stale: true },
    }, stale.fenceToken, leaseNow)).toThrow(StaleFenceError)
    expect(() => context.runRepo.updateTokensFenced(run.id, 1, 1, 0.01, stale.fenceToken, leaseNow)).toThrow(StaleFenceError)

    expect(context.runRepo.updateTerminalStateFenced(run.id, 'stalled', current.fenceToken, leaseNow).terminalState).toBe('stalled')
    expect(context.runCheckpointRepo.upsertFenced(buildCheckpointInput(run, 'implement'), current.fenceToken, leaseNow).stage).toBe('implement')
    expect(context.evidenceRepo.createFenced({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { current: true },
    }, current.fenceToken, leaseNow).payload).toEqual({ current: true })
    expect(context.runRepo.updateTokensFenced(run.id, 1, 2, 0.03, current.fenceToken, leaseNow).costUsd).toBe(0.03)
  })
})
