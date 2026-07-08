import { describe, expect, it } from 'vitest'

import { createId, type Run, type RunId, type TaskId } from '../index.js'
import { createRepoContext, seedBase } from './helpers.js'

describe('RunRepo.getActive keeps scheduler recovery truth (#275)', () => {
  it('returns a run with no completionSummary and a non-done stage', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const task = createTask(ctx, spec.id, builder.id)
    const run = createRun(ctx, task, builder.id, { stage: 'implement' })
    ctx.runRepo.updateCompletionSummary(run.id, '')

    const active = ctx.runRepo.getActive()
    expect(active.map((item) => item.id)).toContain(run.id)
  })

  it('still returns a run once a non-empty completionSummary is recorded', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const task = createTask(ctx, spec.id, builder.id)
    const run = createRun(ctx, task, builder.id, { stage: 'implement' })
    expect(ctx.runRepo.getActive().map((item) => item.id)).toContain(run.id)

    ctx.runRepo.updateCompletionSummary(run.id, 'shipped feature X with tests')

    const active = ctx.runRepo.getActive()
    expect(active.map((item) => item.id)).toContain(run.id)
  })

  it('still returns completionSummary runs whose workflow stage is implement/ship', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const taskA = createTask(ctx, spec.id, builder.id)
    const taskB = createTask(ctx, spec.id, builder.id)
    const implementRun = createRun(ctx, taskA, builder.id, { stage: 'implement' })
    const shipRun = createRun(ctx, taskB, builder.id, { stage: 'ship' })
    ctx.runRepo.updateCompletionSummary(implementRun.id, 'done with implement work')
    ctx.runRepo.updateCompletionSummary(shipRun.id, 'done with ship work')

    const active = ctx.runRepo.getActive()
    const activeIds = active.map((item) => item.id)
    expect(activeIds).toContain(implementRun.id)
    expect(activeIds).toContain(shipRun.id)
  })

  it('treats a whitespace-only completionSummary as no completion', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const task = createTask(ctx, spec.id, builder.id)
    const run = createRun(ctx, task, builder.id, { stage: 'implement' })
    ctx.runRepo.updateCompletionSummary(run.id, '   ')

    // Whitespace-only summaries must NOT count as completion — the agent
    // has to actually describe what changed.
    const active = ctx.runRepo.getActive()
    expect(active.map((item) => item.id)).toContain(run.id)
  })

  it('still excludes done and terminal runs', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const taskA = createTask(ctx, spec.id, builder.id)
    const taskB = createTask(ctx, spec.id, builder.id)
    const doneRun = createRun(ctx, taskA, builder.id, { stage: 'done' })
    const failedRun = createRun(ctx, taskB, builder.id, { stage: 'implement', terminalState: 'failed' })

    const activeIds = ctx.runRepo.getActive().map((item) => item.id)
    expect(activeIds).not.toContain(doneRun.id)
    expect(activeIds).not.toContain(failedRun.id)
  })
})

function createTask(ctx: ReturnType<typeof createRepoContext>, specId: string, agentId: string): TaskId {
  const task = ctx.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: specId as never,
    name: 't',
    prompt: 'p',
    repos: [],
    assignedAgentId: agentId as never,
    requiredRole: 'builder',
    status: 'ready',
    verification: [],
  })
  return task.id
}

function createRun(
  ctx: ReturnType<typeof createRepoContext>,
  taskId: string,
  agentId: string,
  overrides: Partial<Run> = {},
): Run {
  const now = new Date().toISOString()
  return ctx.runRepo.create({
    id: createId<'RunId'>(),
    taskId: taskId as Run['taskId'],
    agentId: agentId as Run['agentId'],
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
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: now,
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}
