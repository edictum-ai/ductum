import { describe, expect, it } from 'vitest'

import { whatToDoNext, type NextActionKind } from '../what-to-do-next.js'
import type { Run, Task } from '../types.js'

const NOW = new Date('2026-06-18T12:00:00.000Z')
const FUTURE = new Date(NOW.getTime() + 60_000).toISOString()

function baseRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1' as Run['id'],
    taskId: 't1' as Run['taskId'],
    agentId: 'a1' as Run['agentId'],
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
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T10:00:00.000Z',
    ...overrides,
  }
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1' as Task['id'],
    specId: 's1' as Task['specId'],
    targetId: null,
    repositoryId: null,
    componentId: null,
    name: 'P1',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'active',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-06-18T10:00:00.000Z',
    updatedAt: '2026-06-18T10:00:00.000Z',
    ...overrides,
  }
}

interface Fixture {
  run: Run
  task: Task | null
  opts?: { now?: Date; hasResumableCheckpoint?: boolean }
  needsOperator: boolean
}

// One fixture per NextActionKind. Typed as Record<NextActionKind, Fixture> so
// TypeScript FAILS if a kind is added without a fixture — the exhaustiveness
// guarantee the brief requires (no unmapped run shape, no blank inbox row).
const FIXTURES: Record<NextActionKind, Fixture> = {
  quarantined: { run: baseRun({ terminalState: 'quarantined', failReason: 'deterministic poison' }), task: baseTask(), needsOperator: true },
  failed: { run: baseRun({ terminalState: 'failed', failReason: 'boom' }), task: baseTask(), needsOperator: true },
  stalled: { run: baseRun({ terminalState: 'stalled', failReason: 'heartbeat stall' }), task: baseTask(), needsOperator: true },
  resumable: { run: baseRun({ terminalState: 'stalled' }), task: baseTask(), opts: { hasResumableCheckpoint: true }, needsOperator: false },
  cancelled: { run: baseRun({ terminalState: 'cancelled' }), task: baseTask(), needsOperator: false },
  paused: { run: baseRun({ terminalState: 'paused' }), task: baseTask(), needsOperator: false },
  frozen: { run: baseRun({ terminalState: 'frozen', failReason: 'cost_budget_paused' }), task: baseTask(), needsOperator: true },
  done: { run: baseRun({ stage: 'done', terminalState: null }), task: baseTask(), needsOperator: false },
  'waiting-on-approval': { run: baseRun({ stage: 'ship', pendingApproval: true }), task: baseTask(), needsOperator: true },
  retrying: { run: baseRun(), task: baseTask({ retryCount: 1, retryAfter: FUTURE }), opts: { now: NOW }, needsOperator: false },
  blocked: { run: baseRun({ stage: 'implement', blockedReason: 'gate blocked: needs read before edit' }), task: baseTask(), needsOperator: false },
  active: { run: baseRun({ stage: 'implement' }), task: baseTask(), needsOperator: false },
  // 'awaiting_review' is not a NextActionKind (review is a workflow-followup,
  // surfaced via the API ui-contract); list every kind explicitly above.
}

describe('whatToDoNext', () => {
  it('maps every fixture to its kind with the expected needsOperator flag', () => {
    const seen = new Set<NextActionKind>()
    for (const [kind, fixture] of Object.entries(FIXTURES) as Array<[NextActionKind, Fixture]>) {
      const result = whatToDoNext(fixture.run, fixture.task, { now: fixture.opts?.now ?? NOW, hasResumableCheckpoint: fixture.opts?.hasResumableCheckpoint })
      expect(result.kind, `fixture for ${kind}`).toBe(kind)
      expect(result.needsOperator, `needsOperator for ${kind}`).toBe(fixture.needsOperator)
      expect(typeof result.reason).toBe('string')
      expect(result.reason.length).toBeGreaterThan(0)
      seen.add(result.kind)
    }
    // No two fixtures collapsed onto the same kind (every kind uniquely covered).
    expect(seen.size).toBe(Object.keys(FIXTURES).length)
  })

  it('a stalled run without a resumable checkpoint is needs-operator, not resumable', () => {
    const result = whatToDoNext(baseRun({ terminalState: 'stalled' }), baseTask(), { now: NOW })
    expect(result.kind).toBe('stalled')
    expect(result.needsOperator).toBe(true)
  })

  it('a stale retryAfter (in the past) is not retrying — the run is active', () => {
    const past = new Date(NOW.getTime() - 60_000).toISOString()
    const result = whatToDoNext(baseRun(), baseTask({ retryAfter: past }), { now: NOW })
    expect(result.kind).toBe('active')
  })

  it('terminal state wins over a leftover done stage and over pendingApproval', () => {
    expect(whatToDoNext(baseRun({ terminalState: 'quarantined', stage: 'done' }), baseTask(), { now: NOW }).kind).toBe('quarantined')
    expect(whatToDoNext(baseRun({ terminalState: 'failed', stage: 'ship', pendingApproval: true }), baseTask(), { now: NOW }).kind).toBe('failed')
  })

  it('approval takes precedence over a set blockedReason at ship', () => {
    const result = whatToDoNext(baseRun({ stage: 'ship', pendingApproval: true, blockedReason: 'awaiting approval' }), baseTask(), { now: NOW })
    expect(result.kind).toBe('waiting-on-approval')
  })

  it('works without a task (null task) for run-only shapes', () => {
    expect(whatToDoNext(baseRun({ terminalState: 'failed' }), null, { now: NOW }).kind).toBe('failed')
    expect(whatToDoNext(baseRun({ stage: 'done' }), null, { now: NOW }).kind).toBe('done')
  })
})
