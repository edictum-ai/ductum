import { describe, expect, it, vi } from 'vitest'

import { retryOrFailStalledTask, type RetryOrFailStalledTaskDeps } from '../dispatcher-stalled-retry.js'
import type { RunStateMachine } from '../state-machine.js'
import type { RunRepo, TaskRepo } from '../repos/interfaces.js'
import type { DAGEvaluator } from '../dag.js'
import type { DuctumEventEmitter } from '../events.js'
import type { Run, RunId, Task } from '../types.js'

interface BuildOpts {
  run?: Partial<Run>
  task?: Partial<Task>
  priorRuns?: Array<Partial<Omit<Run, 'id'>> & { id: string }>
  maxTaskRetries?: number
}

function build(opts: BuildOpts = {}) {
  const run: Run = {
    id: 'r-now' as RunId,
    taskId: 't1' as Run['taskId'],
    failReason: null,
    stage: 'implement',
    terminalState: 'stalled',
    ...opts.run,
  } as Run

  const priorRuns = (opts.priorRuns ?? []).map((p) => ({ ...run, ...p } as Run))

  const runsById = new Map<string, Run>([[run.id, run], ...priorRuns.map((r) => [r.id, r] as const)])

  const task: Task = {
    id: run.taskId,
    specId: 's1' as Task['specId'],
    name: 'P1',
    status: 'active',
    retryCount: 0,
    retryAfter: null,
    ...opts.task,
  } as Task

  const updatedTask = { ...task }

  const runRepo = {
    get: (id: RunId) => runsById.get(id) ?? null,
    list: (taskId: Task['specId'] | Run['taskId']) => [...runsById.values()].filter((r) => r.taskId === taskId),
    updateFailure: vi.fn((id: RunId, reason: string | null, recoverable: boolean) => {
      const current = runsById.get(id)!
      const updated = { ...current, failReason: reason, recoverable } as Run
      runsById.set(id, updated)
      return updated
    }),
  } as unknown as RunRepo

  const taskRepo = {
    get: () => updatedTask,
    updateStatus: vi.fn((_id: Task['id'], status: Task['status']) => {
      updatedTask.status = status
      return updatedTask
    }),
    updateRetry: vi.fn((_id: Task['id'], retryCount: number, retryAfter: string | null) => {
      updatedTask.retryCount = retryCount
      updatedTask.retryAfter = retryAfter
      return updatedTask
    }),
  } as unknown as TaskRepo

  const markQuarantined = vi.fn((id: RunId, _reason: string) => {
    const current = runsById.get(id)!
    runsById.set(id, { ...current, terminalState: 'quarantined' } as Run)
  })
  const stateMachine = { markQuarantined } as unknown as RunStateMachine

  const dag = { evaluateTaskDAG: vi.fn() } as unknown as DAGEvaluator
  const eventEmitter = { emit: vi.fn() } as unknown as DuctumEventEmitter

  const deps: RetryOrFailStalledTaskDeps = {
    runRepo,
    taskRepo,
    dag,
    eventEmitter,
    stateMachine,
    runCheckpointRepo: undefined,
    maxTaskRetries: opts.maxTaskRetries ?? 1,
    retryBackoffScheduleMs: [10_000],
    canSeedWorkflowStage: true,
    now: () => new Date('2026-06-18T12:00:00.000Z'),
  }

  return { deps, run, task: updatedTask, taskRepo, runRepo, stateMachine, runsById }
}

const POISON = 'tests failed: assertion foo'

describe('retryOrFailStalledTask quarantine routing', () => {
  it('quarantines a deterministic failure that exhausted the retry budget', () => {
    const fx = build({
      run: { failReason: POISON },
      task: { retryCount: 1 },
      priorRuns: [{ id: 'r-prev', failReason: POISON }],
      maxTaskRetries: 1,
    })

    const resuming = retryOrFailStalledTask(fx.deps, fx.run.id, 'crash', undefined, { failReason: POISON })

    expect(resuming).toBe(false)
    expect(fx.stateMachine.markQuarantined).toHaveBeenCalledWith(fx.run.id, POISON)
    // Task stays 'active' (the needs-operator convention), NOT 'failed'.
    expect(fx.taskRepo.updateStatus).not.toHaveBeenCalled()
    expect(fx.task.status).toBe('active')
    // The real crash reason is persisted to the run.
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith(fx.run.id, POISON, true)
  })

  it('marks a transient (recoverable) exhaustion failed, not quarantined', () => {
    const fx = build({
      run: { failReason: 'authentication expired' },
      task: { retryCount: 1 },
      priorRuns: [{ id: 'r-prev', failReason: 'authentication expired' }],
      maxTaskRetries: 1,
    })

    retryOrFailStalledTask(fx.deps, fx.run.id, 'crash', undefined, { failReason: 'authentication expired' })

    expect(fx.stateMachine.markQuarantined).not.toHaveBeenCalled()
    expect(fx.taskRepo.updateStatus).toHaveBeenCalledWith(fx.task.id, 'failed')
  })

  it('marks a first-time non-recoverable exhaustion failed (no quarantine on ambiguity)', () => {
    const fx = build({
      run: { failReason: 'weird one-off' },
      task: { retryCount: 1 },
      priorRuns: [],
      maxTaskRetries: 1,
    })

    retryOrFailStalledTask(fx.deps, fx.run.id, 'crash', undefined, { failReason: 'weird one-off' })

    expect(fx.stateMachine.markQuarantined).not.toHaveBeenCalled()
    expect(fx.taskRepo.updateStatus).toHaveBeenCalledWith(fx.task.id, 'failed')
  })

  it('provider-backoff exhaustion (forceTransient) never quarantines', () => {
    const fx = build({
      run: { failReason: POISON },
      task: { retryCount: 1 },
      priorRuns: [{ id: 'r-prev', failReason: POISON }],
      maxTaskRetries: 1,
    })

    retryOrFailStalledTask(fx.deps, fx.run.id, 'crash', undefined, { failReason: POISON, forceTransient: true })

    expect(fx.stateMachine.markQuarantined).not.toHaveBeenCalled()
    expect(fx.taskRepo.updateStatus).toHaveBeenCalledWith(fx.task.id, 'failed')
  })

  it('heartbeat stalls mark the task failed and never reach quarantine', () => {
    const fx = build({
      run: { failReason: POISON },
      task: { retryCount: 1 },
      priorRuns: [{ id: 'r-prev', failReason: POISON }],
      maxTaskRetries: 1,
    })

    retryOrFailStalledTask(fx.deps, fx.run.id, 'heartbeat')

    expect(fx.stateMachine.markQuarantined).not.toHaveBeenCalled()
    expect(fx.taskRepo.updateStatus).toHaveBeenCalledWith(fx.task.id, 'failed')
  })

  it('a crash with retries remaining re-readies the task (no quarantine)', () => {
    const fx = build({
      run: { failReason: POISON },
      task: { retryCount: 0 },
      priorRuns: [],
      maxTaskRetries: 3,
    })

    const resuming = retryOrFailStalledTask(fx.deps, fx.run.id, 'crash', undefined, { failReason: POISON })

    expect(fx.stateMachine.markQuarantined).not.toHaveBeenCalled()
    expect(fx.taskRepo.updateStatus).toHaveBeenCalledWith(fx.task.id, 'ready')
    expect(fx.task.retryAfter).not.toBeNull()
    expect(resuming).toBe(false) // no resumable checkpoint in this fixture
  })
})
