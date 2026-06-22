import { afterEach, describe, expect, it, vi } from 'vitest'

import { DuctumEventEmitter } from '../events.js'
import type { PostCompletionConfig } from '../post-completion.js'
import { PostCompletionRouter, type RouterContext } from '../post-completion-router.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type AgentId, type Run, type RunId, type Spec, type Task } from '../types.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

interface Fixture {
  ctx: RepoContext
  spec: Spec
  builderId: AgentId
  postCompletion: PostCompletionConfig
  router: PostCompletionRouter
}

const cleanup: Fixture[] = []

function structuredReview(verdict: 'pass' | 'warn' | 'fail', summary: string): string {
  return JSON.stringify({ kind: 'ductum-review-result', verdict, summary, findings: [] })
}

function createFixture(postCompletionOverrides: Partial<PostCompletionConfig> = {}): Fixture {
  const ctx = createRepoContext()
  const base = seedBase(ctx)
  const eventEmitter = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(ctx.runRepo, ctx.runStageHistoryRepo, eventEmitter)
  const postCompletion: PostCompletionConfig = {
    resolveVerifyCommands: () => [],
    resolveReviewerAgent: () => null,
    resolveRunCompletionText: () => '',
    onReadyToShip: vi.fn(async () => undefined) as never,
    maxFixIterations: 3,
    ...postCompletionOverrides,
  }
  const router = new PostCompletionRouter({
    runRepo: ctx.runRepo,
    taskRepo: ctx.taskRepo,
    specRepo: ctx.specRepo,
    projectRepo: ctx.projectRepo,
    stateMachine,
    eventEmitter,
    postCompletion,
  } satisfies RouterContext)
  const fixture = { ctx, spec: base.spec, builderId: base.builder.id, postCompletion, router }
  cleanup.push(fixture)
  return fixture
}

function createTask(fixture: Fixture, name: string, requiredRole: Task['requiredRole'] = 'builder'): Task {
  return fixture.ctx.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name,
    prompt: 'implement the task',
    repos: [],
    assignedAgentId: fixture.builderId,
    requiredRole,
    complexity: 'simple',
    status: 'ready',
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,  })
}

function createRun(fixture: Fixture, task: Task, overrides: Partial<Pick<Run, 'parentRunId' | 'worktreePaths'>> = {}): Run {
  return fixture.ctx.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: fixture.builderId,
    parentRunId: overrides.parentRunId ?? null,
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
    worktreePaths: overrides.worktreePaths ?? null,
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

afterEach(() => {
  vi.restoreAllMocks()
  for (const fixture of cleanup.splice(0)) {
    fixture.ctx.db.close()
  }
})

describe('PostCompletionRouter warning review loop', () => {
  it('routes WARN through the fix loop and records the warning verdict', async () => {
    const onReadyToShip = vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined)
    const onReviewResult = vi.fn(async () => undefined)
    const fixture = createFixture({
      onReadyToShip: onReadyToShip as never,
      onReviewResult: onReviewResult as never,
      resolveRunCompletionText: () => structuredReview('warn', 'rename the helper and tighten the null guard'),
    })
    const implTask = createTask(fixture, 'P1')
    const implRun = createRun(fixture, implTask, { worktreePaths: ['/tmp/wt'] })
    const reviewTask = createTask(fixture, 'review-P1', 'reviewer')
    const reviewRun = createRun(fixture, reviewTask, { parentRunId: implRun.id })

    await fixture.router.runReviewCompletion(reviewRun)

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(onReviewResult).toHaveBeenCalledWith(
      reviewRun.id,
      expect.objectContaining({
        verdict: 'warn',
        passed: false,
        feedback: 'rename the helper and tighten the null guard',
      }),
    )

    const fixTask = fixture.ctx.taskRepo.list(fixture.spec.id).find((task) => task.name === 'fix-P1-r1')
    expect(fixTask?.prompt).toContain('Warning Cleanup Task')
    expect(fixTask?.prompt).toContain('warning findings')
  })
})
