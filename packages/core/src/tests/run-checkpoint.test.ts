import { describe, expect, it } from 'vitest'

import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import {
  RESUMABLE_STAGES,
  buildCheckpointInput,
  isResumableCheckpoint,
  type RunCheckpoint,
} from '../run-checkpoint.js'
import { createId, type AgentId, type Run, type RunId, type TaskId, type WorkflowStage } from '../types.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

function seedRun(
  context: RepoContext,
  builderId: AgentId,
  fields: { stage?: WorkflowStage; worktree?: string | null; terminalState?: Run['terminalState']; branch?: string } = {},
): { taskId: TaskId; run: Run } {
  const spec = context.specRepo.list(context.projectRepo.getByName('edictum')!.id)[0]!
  const task = context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: `task-${createId<'TaskId'>()}`,
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: builderId,
    status: 'active',
    verification: ['pnpm test'],
  })
  const run = context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: builderId,
    parentRunId: null,
    stage: fields.stage ?? 'implement',
    terminalState: fields.terminalState ?? null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: fields.branch ?? null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: fields.worktree === undefined ? ['/wt/a'] : fields.worktree == null ? null : [fields.worktree],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-04T12:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
  })
  return { taskId: task.id, run }
}

describe('RunCheckpoint — helpers', () => {
  const base = (overrides: Partial<RunCheckpoint> = {}): RunCheckpoint => ({
    runId: 'r1' as RunId,
    taskId: 't1' as TaskId,
    attemptId: 'r1',
    stage: 'implement',
    completedStages: ['understand'],
    worktreePaths: ['/wt/a'],
    branch: null,
    commitSha: null,
    costUsd: 0,
    schemaVersion: 1,
    committedAt: '2026-04-04T12:00:00.000Z',
    updatedAt: '2026-04-04T12:00:00.000Z',
    ...overrides,
  })

  it('treats understand/implement with a worktree as resumable', () => {
    expect(RESUMABLE_STAGES.has('understand')).toBe(true)
    expect(RESUMABLE_STAGES.has('implement')).toBe(true)
    expect(isResumableCheckpoint(base({ stage: 'understand' }))).toBe(true)
    expect(isResumableCheckpoint(base({ stage: 'implement' }))).toBe(true)
  })

  it('rejects rollback-required (ship) and terminal (done) stages', () => {
    expect(isResumableCheckpoint(base({ stage: 'ship' }))).toBe(false)
    expect(isResumableCheckpoint(base({ stage: 'done' }))).toBe(false)
  })

  it('rejects a checkpoint with no worktree to rebind', () => {
    expect(isResumableCheckpoint(base({ worktreePaths: null }))).toBe(false)
    expect(isResumableCheckpoint(base({ worktreePaths: [] }))).toBe(false)
    expect(isResumableCheckpoint(null)).toBe(false)
  })

  it('buildCheckpointInput snapshots the run, defaulting attemptId to the run id', () => {
    const run = { id: 'r9' as RunId, taskId: 't9' as TaskId, stage: 'implement', completedStages: ['understand'], worktreePaths: ['/wt/x'], branch: 'b', commitSha: 'sha', costUsd: 1.25 } as Run
    const input = buildCheckpointInput(run, 'ship')
    expect(input).toMatchObject({ runId: 'r9', taskId: 't9', attemptId: 'r9', stage: 'ship', commitSha: 'sha', costUsd: 1.25 })
  })
})

describe('SqliteRunCheckpointRepo', () => {
  it('upserts in place (one row per run) and reads back', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id, { stage: 'understand' })

    context.runCheckpointRepo.upsert(buildCheckpointInput(run, 'understand'))
    context.runCheckpointRepo.upsert(buildCheckpointInput(run, 'implement'))

    const checkpoint = context.runCheckpointRepo.get(run.id)
    expect(checkpoint?.stage).toBe('implement')
    expect(checkpoint?.worktreePaths).toEqual(['/wt/a'])
    expect(context.runCheckpointRepo.list(run.taskId)).toHaveLength(1)
    context.db.close()
  })

  it('getLatestStalledCheckpoint returns only stalled runs, newest first', () => {
    const context = createRepoContext()
    seedBase(context)
    const builderId = context.agentRepo.getByName('mimi')!.id

    // A live (non-terminal) run with a checkpoint — must NOT be returned.
    const live = seedRun(context, builderId, { stage: 'implement', terminalState: null })
    context.runCheckpointRepo.upsert(buildCheckpointInput(live.run, 'implement'))
    expect(context.runCheckpointRepo.getLatestStalledCheckpoint(live.taskId)).toBeNull()

    // Mark it stalled — now it is a resume candidate.
    context.runRepo.updateTerminalState(live.run.id, 'stalled')
    const stalled = context.runCheckpointRepo.getLatestStalledCheckpoint(live.taskId)
    expect(stalled?.runId).toBe(live.run.id)
    context.db.close()
  })

  it('delete removes the checkpoint row', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id)
    context.runCheckpointRepo.upsert(buildCheckpointInput(run))
    context.runCheckpointRepo.delete(run.id)
    expect(context.runCheckpointRepo.get(run.id)).toBeNull()
    context.db.close()
  })
})

describe('RunStateMachine — checkpoint writes', () => {
  function machine(context: RepoContext) {
    return new RunStateMachine(context.runRepo, context.runStageHistoryRepo, new DuctumEventEmitter(), {
      runCheckpointRepo: context.runCheckpointRepo,
    })
  }

  it('writes a checkpoint on a forward stage advance', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id, { stage: 'understand', worktree: '/wt/run' })
    machine(context).recordStageAdvance(run.id, 'understand', 'implement', 'analysis done')

    const checkpoint = context.runCheckpointRepo.get(run.id)
    expect(checkpoint?.stage).toBe('implement')
    expect(checkpoint?.worktreePaths).toEqual(['/wt/run'])
    context.db.close()
  })

  it('does not checkpoint the terminal done stage', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id, { stage: 'ship' })
    machine(context).recordStageAdvance(run.id, 'ship', 'done')
    expect(context.runCheckpointRepo.get(run.id)).toBeNull()
    context.db.close()
  })

  it('updates the checkpoint stage on a reset (stays consistent with the run)', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id, { stage: 'ship' })
    const m = machine(context)
    m.recordStageReset(run.id, 'ship', 'implement', 'review failed')
    expect(context.runCheckpointRepo.get(run.id)?.stage).toBe('implement')
    context.db.close()
  })

  it('is inert when no checkpoint repo is wired', () => {
    const context = createRepoContext()
    seedBase(context)
    const { run } = seedRun(context, context.agentRepo.getByName('mimi')!.id)
    const m = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, new DuctumEventEmitter())
    m.recordStageAdvance(run.id, 'understand', 'implement')
    expect(context.runCheckpointRepo.get(run.id)).toBeNull()
    context.db.close()
  })
})
