import { describe, expect, it } from 'vitest'

import { RunStateMachine } from '../state-machine.js'
import type { DuctumEventEmitter } from '../events.js'
import type { RunRepo, RunStageHistoryRepo } from '../repos/interfaces.js'
import type { Run, RunId } from '../types.js'

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'r1' as RunId,
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
  } as Run
}

function makeMachine(initialRun: Run) {
  const runs = new Map<RunId, Run>([[initialRun.id, { ...initialRun }]])
  const events: unknown[] = []
  const transitions: unknown[] = []

  const runRepo = {
    get: (id: RunId) => runs.get(id) ?? null,
    updateTerminalState: (id: RunId, terminalState: Run['terminalState']) => {
      const run = runs.get(id)!
      const updated = { ...run, terminalState } as Run
      runs.set(id, updated)
      return updated
    },
    updateWorkflowState: (id: RunId, fields: { blockedReason?: string | null; pendingApproval?: boolean }) => {
      const run = runs.get(id)!
      const updated = { ...run, ...fields } as Run
      runs.set(id, updated)
      return updated
    },
    updateFailure: (id: RunId, reason: string | null, recoverable: boolean) => {
      const run = runs.get(id)!
      const updated = { ...run, failReason: reason, recoverable } as Run
      runs.set(id, updated)
      return updated
    },
  } as unknown as RunRepo

  const stageHistoryRepo = {
    add: (t: unknown) => {
      transitions.push(t)
      return t as never
    },
  } as unknown as RunStageHistoryRepo

  const eventEmitter = {
    emit: (e: unknown) => events.push(e),
    emitRecord: (e: unknown) => events.push(e),
  } as unknown as DuctumEventEmitter

  const machine = new RunStateMachine(runRepo, stageHistoryRepo, eventEmitter)
  return { machine, runs, events, transitions }
}

describe('RunStateMachine.markQuarantined', () => {
  it('widens a stalled run into quarantined and records the reason', () => {
    const { machine, runs, events } = makeMachine(makeRun({ terminalState: 'stalled', pendingApproval: true, blockedReason: 'x' }))

    const updated = machine.markQuarantined('r1' as RunId, 'deterministic poison')

    expect(updated.terminalState).toBe('quarantined')
    expect(updated.failReason).toBe('deterministic poison')
    expect(updated.recoverable).toBe(false)
    expect(updated.pendingApproval).toBe(false)
    expect(updated.blockedReason).toBe(null)
    expect(runs.get('r1' as RunId)?.terminalState).toBe('quarantined')
    expect(events).toContainEqual({ type: 'run.quarantined', runId: 'r1', reason: 'deterministic poison' })
  })

  it('widens a failed run into quarantined', () => {
    const { machine } = makeMachine(makeRun({ terminalState: 'failed' }))
    expect(machine.markQuarantined('r1' as RunId, 'poison').terminalState).toBe('quarantined')
  })

  it.each(['paused', 'frozen', 'cancelled'] as const)('refuses to clobber a %s run', (state) => {
    const { machine } = makeMachine(makeRun({ terminalState: state }))
    expect(() => machine.markQuarantined('r1' as RunId, 'x')).toThrow(/Cannot quarantine/)
  })

  it('refuses to quarantine an active (non-terminal) run', () => {
    const { machine } = makeMachine(makeRun({ terminalState: null }))
    expect(() => machine.markQuarantined('r1' as RunId, 'x')).toThrow(/Cannot quarantine/)
  })

  it('refuses to quarantine a done run', () => {
    const { machine } = makeMachine(makeRun({ stage: 'done' }))
    expect(() => machine.markQuarantined('r1' as RunId, 'x')).toThrow(/done/)
  })
})
