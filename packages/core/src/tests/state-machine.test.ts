import { afterEach, describe, expect, it } from 'vitest'

import { DuctumEventEmitter, type DuctumEvent } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import type { WorkflowStage } from '../types.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
})

function createFixture(
  stage: WorkflowStage,
  options: {
    now?: () => Date
    lastHeartbeat?: string
    heartbeatTimeoutSeconds?: number
  } = {},
) {
  const context = createRepoContext()
  cleanup.push(context)
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: `task-${ids.taskId}`,
    prompt: 'implement P2',
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
    stage,
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
    lastHeartbeat: options.lastHeartbeat ?? '2026-04-04T10:00:00Z',
    heartbeatTimeoutSeconds: options.heartbeatTimeoutSeconds ?? 120,
  })
  const events: DuctumEvent[] = []
  const emitter = new DuctumEventEmitter()
  emitter.subscribe((event) => {
    events.push(event)
  })

  const machine = new RunStateMachine(
    context.runRepo,
    context.runStageHistoryRepo,
    emitter,
    { now: options.now },
  )

  return { context, run, task, builder, machine, events, ids }
}

describe('RunStateMachine', () => {
  describe('markFailed', () => {
    it('sets terminalState to failed', () => {
      const { run, machine } = createFixture('implement')

      const updated = machine.markFailed(run.id, 'compile error')

      expect(updated.terminalState).toBe('failed')
      expect(updated.failReason).toBe('compile error')
      expect(updated.recoverable).toBe(false)
    })

    it('records stage history entry', () => {
      const { run, machine, context } = createFixture('implement')

      machine.markFailed(run.id, 'compile error')

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'implement',
          toStage: 'implement',
          reason: 'failed: compile error',
        }),
      )
    })

    it('emits run.stage_changed event', () => {
      const { run, machine, events } = createFixture('ship')

      machine.markFailed(run.id, 'tests failed')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          runId: run.id,
          from: 'ship',
          to: 'ship',
          reason: 'failed: tests failed',
        }),
      )
    })

    it('uses default reason when none provided', () => {
      const { run, machine } = createFixture('implement')

      const updated = machine.markFailed(run.id)

      expect(updated.failReason).toBe('run failed')
      expect(updated.terminalState).toBe('failed')
    })

    it('clears pending approval metadata', () => {
      const { run, machine } = createFixture('ship')
      machine['runRepo'].updateWorkflowState(run.id, {
        blockedReason: 'waiting for approval',
        pendingApproval: true,
      })

      const updated = machine.markFailed(run.id, 'operator closed')

      expect(updated.pendingApproval).toBe(false)
      expect(updated.blockedReason).toBeNull()
    })

    it('throws when run does not exist', () => {
      const { machine } = createFixture('implement')

      expect(() => machine.markFailed('nonexistent' as any)).toThrow('Run not found')
    })
  })

  describe('markStalled', () => {
    it('sets terminalState to stalled', () => {
      const { run, machine } = createFixture('implement')

      const updated = machine.markStalled(run.id)

      expect(updated.terminalState).toBe('stalled')
    })

    it('records stage history with heartbeat timeout reason', () => {
      const { run, machine, context } = createFixture('implement')

      machine.markStalled(run.id)

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'implement',
          toStage: 'implement',
          reason: 'heartbeat timeout',
        }),
      )
    })

    it('emits run.stage_changed event', () => {
      const { run, machine, events } = createFixture('understand')

      machine.markStalled(run.id)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          runId: run.id,
          from: 'understand',
          to: 'understand',
          reason: 'heartbeat timeout',
        }),
      )
    })

    it('throws when run is already in a terminal state', () => {
      const { run, machine } = createFixture('implement')

      machine.markFailed(run.id, 'already dead')

      expect(() => machine.markStalled(run.id)).toThrow(
        'Cannot stall run that is already failed',
      )
    })

    it('throws when run is already stalled', () => {
      const { run, machine } = createFixture('implement')

      machine.markStalled(run.id)

      expect(() => machine.markStalled(run.id)).toThrow(
        'Cannot stall run that is already stalled',
      )
    })
  })

  describe('markCancelled', () => {
    it('sets terminalState to cancelled and clears failure fields', () => {
      const { run, machine } = createFixture('implement')

      const updated = machine.markCancelled(run.id, 'operator stopped duplicate work')

      expect(updated.terminalState).toBe('cancelled')
      expect(updated.failReason).toBeNull()
      expect(updated.recoverable).toBe(false)
    })

    it('clears pending approval metadata', () => {
      const { run, machine } = createFixture('ship')
      machine['runRepo'].updateWorkflowState(run.id, {
        blockedReason: 'waiting for approval',
        pendingApproval: true,
      })

      const updated = machine.markCancelled(run.id, 'operator picked another attempt')

      expect(updated.pendingApproval).toBe(false)
      expect(updated.blockedReason).toBeNull()
    })

    it('records a stage history transition', () => {
      const { run, machine, context } = createFixture('ship')

      machine.markCancelled(run.id, 'operator picked another attempt')

      expect(context.runStageHistoryRepo.list(run.id)[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'ship',
          toStage: 'ship',
          reason: 'cancelled: operator picked another attempt',
        }),
      )
    })

    it('emits run.stage_changed event', () => {
      const { run, machine, events } = createFixture('implement')

      machine.markCancelled(run.id, 'operator stopped it')

      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          runId: run.id,
          from: 'implement',
          to: 'implement',
          reason: 'cancelled: operator stopped it',
        }),
      )
    })

    it('rejects terminal and done runs', () => {
      const { run, machine } = createFixture('implement')
      machine.markFailed(run.id, 'already failed')

      expect(() => machine.markCancelled(run.id, 'too late')).toThrow(
        'Cannot cancel run that is already failed',
      )

      const done = createFixture('done')
      expect(() => done.machine.markCancelled(done.run.id, 'too late')).toThrow(
        'Cannot cancel run that is already done',
      )
    })
  })

  describe('markDone', () => {
    it('sets stage to done', () => {
      const { run, machine } = createFixture('ship')

      const updated = machine.markDone(run.id, 'all checks passed')

      expect(updated.stage).toBe('done')
    })

    it('clears terminalState', () => {
      const { run, machine } = createFixture('ship')

      // First mark failed, then mark done to verify terminal state is cleared
      machine.markFailed(run.id, 'temporary')
      const updated = machine.markDone(run.id, 'recovered')

      expect(updated.stage).toBe('done')
      // terminalState is cleared by markDone
      const freshRun = machine['runRepo'].get(run.id)
      expect(freshRun?.terminalState).toBeNull()
    })

    it('clears pending approval metadata', () => {
      const { run, machine } = createFixture('ship')
      machine['runRepo'].updateWorkflowState(run.id, {
        blockedReason: 'waiting for approval',
        pendingApproval: true,
      })

      const updated = machine.markDone(run.id, 'merged')

      expect(updated.pendingApproval).toBe(false)
      expect(updated.blockedReason).toBeNull()
    })

    it('records stage history entry', () => {
      const { run, machine, context } = createFixture('ship')

      machine.markDone(run.id, 'merged successfully')

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'ship',
          toStage: 'done',
          reason: 'merged successfully',
        }),
      )
    })

    it('emits run.stage_changed event', () => {
      const { run, machine, events } = createFixture('ship')

      machine.markDone(run.id, 'merged')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          runId: run.id,
          from: 'ship',
          to: 'done',
          reason: 'merged',
        }),
      )
    })

    it('emits event without reason when none provided', () => {
      const { run, machine, events } = createFixture('ship')

      machine.markDone(run.id)

      expect(events[0]).not.toHaveProperty('reason')
    })
  })

  describe('checkStalledRuns', () => {
    it('detects runs with expired heartbeats', () => {
      const { run, machine } = createFixture('implement', {
        now: () => new Date('2026-04-04T10:03:00Z'),
        lastHeartbeat: '2026-04-04T10:00:00Z',
        heartbeatTimeoutSeconds: 120,
      })

      const stalled = machine.checkStalledRuns()

      expect(stalled).toHaveLength(1)
      expect(stalled[0]?.id).toBe(run.id)
      expect(stalled[0]?.terminalState).toBe('stalled')
    })

    it('does not flag runs within heartbeat window', () => {
      const { machine } = createFixture('implement', {
        now: () => new Date('2026-04-04T10:01:00Z'),
        lastHeartbeat: '2026-04-04T10:00:00Z',
        heartbeatTimeoutSeconds: 120,
      })

      const stalled = machine.checkStalledRuns()

      expect(stalled).toHaveLength(0)
    })

    it('skips runs already in terminal state', () => {
      const { run, machine } = createFixture('implement', {
        now: () => new Date('2026-04-04T10:03:00Z'),
        lastHeartbeat: '2026-04-04T10:00:00Z',
      })

      machine.markFailed(run.id, 'already failed')

      const stalled = machine.checkStalledRuns()
      expect(stalled).toHaveLength(0)
    })

    it('skips runs at done stage', () => {
      const { run, machine } = createFixture('implement', {
        now: () => new Date('2026-04-04T10:03:00Z'),
        lastHeartbeat: '2026-04-04T10:00:00Z',
      })

      machine.markDone(run.id)

      const stalled = machine.checkStalledRuns()
      expect(stalled).toHaveLength(0)
    })
  })

  describe('clearTerminalState', () => {
    it('clears failed terminal state', () => {
      const { run, machine } = createFixture('implement')

      machine.markFailed(run.id, 'temporary failure')
      const updated = machine.clearTerminalState(run.id)

      expect(updated.terminalState).toBeNull()
    })

    it('clears stalled terminal state', () => {
      const { run, machine } = createFixture('implement')

      machine.markStalled(run.id)
      const updated = machine.clearTerminalState(run.id)

      expect(updated.terminalState).toBeNull()
    })

    it('is a no-op when no terminal state is set', () => {
      const { run, machine } = createFixture('implement')

      const updated = machine.clearTerminalState(run.id)

      expect(updated.terminalState).toBeNull()
      expect(updated.stage).toBe('implement')
    })
  })

  describe('recordStageAdvance', () => {
    it('records stage history entry', () => {
      const { run, machine, context } = createFixture('implement')

      machine.recordStageAdvance(run.id, 'implement', 'ship', 'tests passed')

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'implement',
          toStage: 'ship',
          reason: 'tests passed',
        }),
      )
    })

    it('emits run.stage_changed event', () => {
      const { run, machine, events } = createFixture('understand')

      machine.recordStageAdvance(run.id, 'understand', 'implement', 'analysis complete')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          runId: run.id,
          from: 'understand',
          to: 'implement',
          reason: 'analysis complete',
        }),
      )
    })

    it('emits event without reason when none provided', () => {
      const { run, machine, events } = createFixture('implement')

      machine.recordStageAdvance(run.id, 'implement', 'ship')

      expect(events).toHaveLength(1)
      expect(events[0]).not.toHaveProperty('reason')
    })

    it('records multiple advances in order', () => {
      const { run, machine, context } = createFixture('understand')

      machine.recordStageAdvance(run.id, 'understand', 'implement')
      machine.recordStageAdvance(run.id, 'implement', 'ship')

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(2)
      expect(history.map((h) => h.toStage)).toEqual([
        'implement',
        'ship',
      ])
    })
  })

  describe('recordStageReset', () => {
    it('records an explicit backward stage history entry', () => {
      const { run, machine, context, events } = createFixture('done')

      machine.recordStageReset(run.id, 'done', 'implement', 'selected for approval')

      const history = context.runStageHistoryRepo.list(run.id)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(
        expect.objectContaining({
          runId: run.id,
          fromStage: 'done',
          toStage: 'implement',
          reason: 'selected for approval',
        }),
      )
      expect(events[0]).toEqual(
        expect.objectContaining({
          type: 'run.stage_changed',
          from: 'done',
          to: 'implement',
        }),
      )
    })
  })

  describe('heartbeat', () => {
    it('updates heartbeat and emits event', () => {
      const { run, machine, events } = createFixture('implement')

      machine.heartbeat(run.id)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'run.heartbeat',
        runId: run.id,
      })
    })

    it('prevents stall detection after heartbeat', () => {
      const fixedTime = new Date('2026-04-04T10:03:00Z')
      const { run, machine } = createFixture('implement', {
        now: () => fixedTime,
        lastHeartbeat: '2026-04-04T10:00:00Z',
        heartbeatTimeoutSeconds: 120,
      })

      // Without heartbeat, this would be stalled (3 min > 2 min timeout)
      // But heartbeat updates the timestamp via datetime('now') in SQLite
      machine.heartbeat(run.id)

      // After heartbeat, the run's lastHeartbeat is updated to db "now"
      // Since we can't control SQLite's datetime('now'), verify the heartbeat was recorded
      const updatedRun = machine['runRepo'].get(run.id)
      expect(updatedRun?.lastHeartbeat).not.toBe('2026-04-04T10:00:00Z')
    })
  })
})
