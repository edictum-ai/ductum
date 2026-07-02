
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DuctumEventEmitter } from '../../events.js'
import {
  classifyTask,
  parseTaskName,
  PostCompletionRouter,
  type RouterContext,
} from '../../post-completion-router.js'
import type { EvidenceRepo } from '../../repos/interfaces.js'
import type { PostCompletionConfig } from '../../post-completion.js'
import { RunStateMachine } from '../../state-machine.js'
import {
  createId,
  type AgentId,
  type BestOfNPolicy,
  type Run,
  type RunId,
  type Spec,
  type SpecId,
  type Task,
  type TaskId,
} from '../../types.js'
import { createRepoContext, seedBase, type RepoContext } from '../helpers.js'

export const gitFixtureTimeoutMs = 20_000

export function structuredReview(verdict: 'pass' | 'warn' | 'fail', summary: string, findings: string[] = []): string {
  return JSON.stringify({ kind: 'ductum-review-result', verdict, summary, findings })
}

export function structuredBakeoff(winnerTaskId: string, taskIds: string[], opts: { passedByTaskId?: Record<string, boolean>; policy?: BestOfNPolicy; includeCost?: boolean; includeOverride?: boolean; verdict?: 'pass' | 'warn' | 'fail' } = {}): string {
  return JSON.stringify({
    kind: 'ductum-review-result',
    verdict: opts.verdict ?? 'pass',
    summary: 'structured verdict attached',
    findings: [],
    bestOfN: {
      winnerTaskId,
      scores: taskIds.map((taskId) => ({
        taskId,
        passed: opts.passedByTaskId?.[taskId] ?? true,
        notes: 'reviewed',
        ...(opts.includeCost === true ? { costUsd: 1.23 } : {}),
      })),
      policy: opts.policy ?? 'quality-gated-cost-aware',
      reason: 'stronger implementation',
      ...(opts.includeOverride === true ? { override: { operatorId: 'operator-1', reason: 'manual override' } } : {}),
    },
  })
}

export interface RouterFixture {
  ctx: RepoContext
  router: PostCompletionRouter
  spec: Spec
  builder: { id: AgentId }
  events: DuctumEventEmitter
  postCompletion: PostCompletionConfig
  buildContext(overrides?: Partial<RouterContext>): RouterContext
}

export function createFixture(opts: {
  postCompletion?: Partial<PostCompletionConfig>
  specMaxFixIterations?: number | null
  bakeoff?: boolean
  bakeoffPolicy?: BestOfNPolicy
} = {}): RouterFixture {
  const ctx = createRepoContext()
  const base = seedBase(ctx)
  // Re-create the spec with special test metadata when requested.
  if (opts.specMaxFixIterations !== undefined || opts.bakeoff === true) {
    ctx.specRepo.delete(base.spec.id)
    base.spec = ctx.specRepo.create({
      id: base.spec.id,
      projectId: base.project.id,
      name: base.spec.name,
      status: base.spec.status,
      strategy: opts.bakeoff === true ? 'best_of_n' : base.spec.strategy,
      strategyConfig: opts.bakeoff === true
        ? {
            kind: 'best_of_n',
            policy: opts.bakeoffPolicy ?? 'quality-gated-cost-aware',
            strategyGroup: 'bon-1',
            builderAgentIds: [base.builder.id],
            reviewerAgentId: 'reviewer-agent',
            verify: [],
          }
        : base.spec.strategyConfig,
      document: base.spec.document,
      maxFixIterations: opts.specMaxFixIterations,
    })
  }
  const events = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(ctx.runRepo, ctx.runStageHistoryRepo, events)
  const postCompletion: PostCompletionConfig = {
    resolveVerifyCommands: () => [], // skip the actual verify shellout
    resolveReviewerAgent: () => null,
    resolveRunCompletionText: () => '',
    onReadyToShip: vi.fn<(_runId: RunId) => Promise<void>>(async () => undefined) as never,
    maxFixIterations: 3,
    ...opts.postCompletion,
  }
  const buildContext = (overrides: Partial<RouterContext> = {}): RouterContext => ({
    runRepo: ctx.runRepo,
    taskRepo: ctx.taskRepo,
    specRepo: ctx.specRepo,
    projectRepo: ctx.projectRepo,
    evidenceRepo: ctx.evidenceRepo,
    stateMachine,
    eventEmitter: events,
    postCompletion,
    evaluateTaskDAG: vi.fn(),
    transaction: (fn) => ctx.db.transaction(fn)(),
    ...overrides,
  })
  const router = new PostCompletionRouter(buildContext())
  return { ctx, router, spec: base.spec, builder: base.builder, events, postCompletion, buildContext }
}

export function createTask(
  fixture: RouterFixture,
  overrides: Partial<Pick<Task, 'id' | 'name' | 'status' | 'requiredRole' | 'strategyRole' | 'strategyGroup' | 'verification'>> = {},
): Task {
  return fixture.ctx.taskRepo.create({
    id: overrides.id ?? createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: overrides.name ?? `task-${Math.random().toString(36).slice(2, 6)}`,
    prompt: '',
    repos: [],
    assignedAgentId: fixture.builder.id,
    requiredRole: overrides.requiredRole ?? 'builder',
    complexity: 'simple',
    strategyRole: overrides.strategyRole,
    strategyGroup: overrides.strategyGroup,
    status: overrides.status ?? 'ready',
    verification: overrides.verification ?? [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,  })
}

export function createRun(
  fixture: RouterFixture,
  task: Task,
  overrides: Partial<Pick<Run, 'id' | 'parentRunId' | 'worktreePaths' | 'stage' | 'terminalState' | 'runtimeWorkflowProfile'>> = {},
): Run {
  return fixture.ctx.runRepo.create({
    id: overrides.id ?? createId<'RunId'>(),
    taskId: task.id,
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
    worktreePaths: overrides.worktreePaths ?? null,
    runtimeWorkflowProfile: overrides.runtimeWorkflowProfile ?? null,
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

export function createTempGitWorktree(): {
  root: string
  worktree: string
  branch: string
  commitSha: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-git-artifacts-'))
  const worktree = path.join(root, 'repo')
  fs.mkdirSync(worktree)
  const git = (...args: string[]) => execFileSync('git', ['-C', worktree, ...args], { stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(worktree, 'base.txt'), 'base\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'base')
  const branch = 'feature/git-artifacts'
  git('checkout', '-b', branch)
  fs.writeFileSync(path.join(worktree, 'feature.txt'), 'feature\n')
  git('add', '.')
  git('commit', '--no-verify', '-m', 'feature commit')
  const commitSha = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  }).trim()
  return { root, worktree, branch, commitSha }
}

afterEach(() => {
  vi.restoreAllMocks()
})

export { fs, os, path, execFileSync, afterEach, beforeEach, describe, expect, it, vi, classifyTask, parseTaskName, PostCompletionRouter, createId }
export type { AgentId, EvidenceRepo, PostCompletionConfig, RepoContext, RouterContext, Run, RunId, Spec, SpecId, Task, TaskId }
