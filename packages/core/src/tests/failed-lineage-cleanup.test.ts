import { afterEach, describe, expect, it } from 'vitest'

import { DuctumEventEmitter } from '../events.js'
import { closeFailedLineageDescendants } from '../failed-lineage-cleanup.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Run, type TerminalState } from '../types.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: RepoContext[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) context.db.close()
})

function createFixture() {
  const context = createRepoContext()
  cleanup.push(context)
  const { builder, spec } = seedBase(context)
  const events = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, events)
  return { context, builder, spec, events, stateMachine }
}

type TaskOverrides = {
  name: string
  status?: 'active' | 'done' | 'failed' | 'ready'
  requiredRole?: 'builder' | 'reviewer'
}

function createTask(fixture: ReturnType<typeof createFixture>, overrides: TaskOverrides) {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: overrides.name,
    prompt: '',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    requiredRole: overrides.requiredRole ?? 'builder',
    status: overrides.status ?? 'active',
    verification: [],
  })
}

function createRun(
  fixture: ReturnType<typeof createFixture>,
  taskId: Run['taskId'],
  overrides: Partial<Pick<Run, 'parentRunId' | 'stage' | 'terminalState'>> = {},
) {
  return fixture.context.runRepo.create({
    id: createId<'RunId'>(),
    taskId,
    agentId: fixture.builder.id,
    parentRunId: overrides.parentRunId ?? null,
    stage: overrides.stage ?? 'implement',
    terminalState: overrides.terminalState ?? null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/wt'],
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
}

function closeLineage(
  fixture: ReturnType<typeof createFixture>,
  rootRun: Run,
  currentRun: Run,
  disposition: 'done' | 'failed' = 'done',
) {
  return closeFailedLineageDescendants({
    runRepo: fixture.context.runRepo,
    taskRepo: fixture.context.taskRepo,
    stateMachine: fixture.stateMachine,
    eventEmitter: fixture.events,
  }, {
    rootRun,
    currentRun,
    currentRunDisposition: disposition,
    reason: 'lineage cleanup',
  })
}

describe('closeFailedLineageDescendants terminal run preservation', () => {
  it('preserves a quarantined sibling run and leaves its active task visible', () => {
    const fixture = createFixture()
    const rootTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const rootRun = createRun(fixture, rootTask.id, { terminalState: 'failed' })
    const quarantinedTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const quarantinedRun = createRun(fixture, quarantinedTask.id, {
      parentRunId: rootRun.id,
      terminalState: 'quarantined',
    })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask.id, { parentRunId: quarantinedRun.id })

    const result = closeLineage(fixture, rootRun, reviewRun)

    expect(result.closedRunIds).toEqual([reviewRun.id])
    expect(fixture.context.runRepo.get(quarantinedRun.id)?.terminalState).toBe('quarantined')
    expect(fixture.context.taskRepo.get(quarantinedTask.id)?.status).toBe('active')
    expect(fixture.context.runRepo.get(reviewRun.id)?.stage).toBe('done')
    expect(fixture.context.taskRepo.get(reviewTask.id)?.status).toBe('done')
  })

  it.each(['paused', 'frozen', 'cancelled'] as const)('preserves a %s sibling run', (terminalState) => {
    const fixture = createFixture()
    const rootTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const rootRun = createRun(fixture, rootTask.id, { terminalState: 'failed' })
    const siblingTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const siblingRun = createRun(fixture, siblingTask.id, { parentRunId: rootRun.id, terminalState })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask.id, { parentRunId: siblingRun.id })

    const result = closeLineage(fixture, rootRun, reviewRun)

    expect(result.closedRunIds).not.toContain(siblingRun.id)
    expect(fixture.context.runRepo.get(siblingRun.id)?.terminalState).toBe(terminalState)
    expect(fixture.context.taskRepo.get(siblingTask.id)?.status).toBe('active')
  })

  it('force-closes an active sibling run to failed', () => {
    const fixture = createFixture()
    const rootTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const rootRun = createRun(fixture, rootTask.id, { terminalState: 'failed' })
    const activeTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const activeRun = createRun(fixture, activeTask.id, { parentRunId: rootRun.id })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask.id, { parentRunId: activeRun.id })

    const result = closeLineage(fixture, rootRun, reviewRun)

    expect(result.closedRunIds).toEqual([activeRun.id, reviewRun.id])
    expect(fixture.context.runRepo.get(activeRun.id)?.terminalState).toBe('failed')
    expect(fixture.context.taskRepo.get(activeTask.id)?.status).toBe('failed')
  })

  it('skips done sibling runs while still resolving their task done', () => {
    const fixture = createFixture()
    const rootTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const rootRun = createRun(fixture, rootTask.id, { terminalState: 'failed' })
    const doneTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const doneRun = createRun(fixture, doneTask.id, { parentRunId: rootRun.id, stage: 'done' })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask.id, { parentRunId: doneRun.id })

    const result = closeLineage(fixture, rootRun, reviewRun)

    expect(result.closedRunIds).not.toContain(doneRun.id)
    expect(fixture.context.runRepo.get(doneRun.id)?.stage).toBe('done')
    expect(fixture.context.runRepo.get(doneRun.id)?.terminalState).toBeNull()
    expect(fixture.context.taskRepo.get(doneTask.id)?.status).toBe('done')
  })

  it('preserves stalled sibling runs instead of clobbering them to failed', () => {
    const fixture = createFixture()
    const rootTask = createTask(fixture, { name: 'P1', status: 'failed' })
    const rootRun = createRun(fixture, rootTask.id, { terminalState: 'failed' })
    const stalledTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const stalledRun = createRun(fixture, stalledTask.id, { parentRunId: rootRun.id, terminalState: 'stalled' })
    const reviewTask = createTask(fixture, { name: 'review-P1-r2', status: 'active', requiredRole: 'reviewer' })
    const reviewRun = createRun(fixture, reviewTask.id, { parentRunId: stalledRun.id })

    const result = closeLineage(fixture, rootRun, reviewRun)

    expect(result.closedRunIds).not.toContain(stalledRun.id)
    expect(fixture.context.runRepo.get(stalledRun.id)?.terminalState).toBe('stalled')
    expect(fixture.context.taskRepo.get(stalledTask.id)?.status).toBe('active')
  })

  it.each(['quarantined', 'paused', 'frozen', 'cancelled', 'stalled', 'failed'] as const)(
    'does not re-mark a current %s run as done or failed',
    (terminalState: TerminalState) => {
      const fixture = createFixture()
      const task = createTask(fixture, { name: 'P1', status: 'active' })
      const run = createRun(fixture, task.id, { terminalState })

      const doneResult = closeLineage(fixture, run, run, 'done')
      const failedResult = closeLineage(fixture, run, run, 'failed')

      expect(doneResult.closedRunIds).toEqual([])
      expect(failedResult.closedRunIds).toEqual([])
      expect(fixture.context.runRepo.get(run.id)?.terminalState).toBe(terminalState)
      expect(fixture.context.runRepo.get(run.id)?.stage).toBe('implement')
      expect(fixture.context.taskRepo.get(task.id)?.status).toBe(terminalState === 'failed' ? 'failed' : 'active')
    },
  )
})
