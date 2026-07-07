import { describe, expect, it } from 'vitest'

import { createId, type Run, type RunId, type TaskId } from '../index.js'
import { createRepoContext, seedBase } from './helpers.js'

/**
 * #275 regression: a completed attempt must move out of the active list
 * exactly once — even if the workflow runtime has not advanced the stage
 * to 'done'. Before this fix, runs that recorded a completionSummary but
 * still had stage='implement' (or 'verify', 'ship') kept appearing in
 * `ductum watch --once` active output, disagreeing with logs that showed
 * `ductum_complete` had been called.
 */
describe('RunRepo.getActive excludes agent-completed runs (#275)', () => {
  it('returns a run with no completionSummary and a non-done stage', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const task = createTask(ctx, spec.id, builder.id)
    const run = createRun(ctx, task, builder.id, { stage: 'implement' })
    ctx.runRepo.updateCompletionSummary(run.id, '')

    const active = ctx.runRepo.getActive()
    expect(active.map((item) => item.id)).toContain(run.id)
  })

  it('excludes a run once a non-empty completionSummary is recorded', () => {
    const ctx = createRepoContext()
    const { builder, spec } = seedBase(ctx)
    const task = createTask(ctx, spec.id, builder.id)
    const run = createRun(ctx, task, builder.id, { stage: 'implement' })
    expect(ctx.runRepo.getActive().map((item) => item.id)).toContain(run.id)

    ctx.runRepo.updateCompletionSummary(run.id, 'shipped feature X with tests')

    const active = ctx.runRepo.getActive()
    expect(active.map((item) => item.id)).not.toContain(run.id)
  })

  it('excludes a run whose completionSummary is set but workflow stage is still implement/ship', () => {
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
    expect(activeIds).not.toContain(implementRun.id)
    expect(activeIds).not.toContain(shipRun.id)
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
