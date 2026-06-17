import { describe, it, expect } from 'vitest'
import { createId } from '../index.js'
import { createRepoContext, seedBase } from './helpers.js'
import { evidenceContentSha } from '../evidence-content-hash.js'

function seedRun(context: ReturnType<typeof createRepoContext>) {
  const { spec, builder } = seedBase(context)
  const taskId = createId<'TaskId'>()
  const runId = createId<'RunId'>()
  context.taskRepo.create({
    id: taskId,
    specId: spec.id,
    name: 'T',
    prompt: 'p',
    repos: ['packages/core'],
    assignedAgentId: null,
    status: 'ready',
    verification: ['pnpm test'],
  })
  context.runRepo.create({
    id: runId,
    taskId,
    agentId: builder.id,
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
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
  return runId
}

describe('evidenceContentSha', () => {
  it('is canonical (key-order independent) and distinguishes type and payload', () => {
    const a = evidenceContentSha('custom', { reason: 'x', source: 'op' })
    const b = evidenceContentSha('custom', { source: 'op', reason: 'x' })
    const c = evidenceContentSha('custom', { reason: 'y', source: 'op' })
    const d = evidenceContentSha('review', { reason: 'x', source: 'op' })
    expect(a).toBe(b) // sorted keys -> structurally identical payloads hash equally
    expect(a).not.toBe(c) // payload differs
    expect(a).not.toBe(d) // type differs
  })
})

describe('SqliteEvidenceRepo.create — idempotent write', () => {
  it('dedups a retried identical evidence write for the same run (no duplicate, no PK throw)', () => {
    const context = createRepoContext()
    const runId = seedRun(context)
    const payload = { passed: true, source: 'verify', detail: 'all green' }

    const first = context.evidenceRepo.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload })
    // Crash-retry: same logical evidence, a NEW client id (as createId() would produce).
    const second = context.evidenceRepo.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload })

    expect(context.evidenceRepo.list(runId)).toHaveLength(1)
    expect(second.id).toBe(first.id) // returns the existing row rather than inserting a duplicate
  })

  it('keeps genuinely distinct evidence as separate rows', () => {
    const context = createRepoContext()
    const runId = seedRun(context)
    context.evidenceRepo.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload: { n: 1 } })
    context.evidenceRepo.create({ id: createId<'EvidenceId'>(), runId, type: 'custom', payload: { n: 2 } })
    expect(context.evidenceRepo.list(runId)).toHaveLength(2)
  })
})
