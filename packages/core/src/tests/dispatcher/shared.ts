import { afterEach, vi } from 'vitest'
export { describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../../dispatcher.js'
import { DuctumEventEmitter } from '../../events.js'
import type { PostCompletionConfig } from '../../post-completion.js'
import { RunStateMachine } from '../../state-machine.js'
import { createId, type Agent, type Run, type RunWorkflowProfileSnapshot, type Task, type WorkflowStage } from '../../types.js'
import { WatcherManager } from '../../watcher-manager.js'
import type { WorkflowProfileRuntimeData } from '../../workflow-profile-runtime.js'
import type { WorktreeManager } from '../../worktree.js'
import type { PrerequisiteIssue } from '../../repair-types.js'
import { createRepoContext, seedBase } from '../helpers.js'
export { DAGEvaluator, Dispatcher, RunStateMachine, WatcherManager, createId }
export type { PostCompletionConfig, Run, Task, WorktreeManager }

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  vi.useRealTimers()
  for (const entry of cleanup.splice(0)) entry.close()
})

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createAdapter(name: string, order: string[] = []) {
  const sessions: Array<{ sessionId: string; runId: Run['id']; done: ReturnType<typeof deferred<HarnessSessionResult>> }> = []
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    order.push(`${name}:spawn`)
    const done = deferred<HarnessSessionResult>()
    const session = { sessionId: `${name}-session-${sessions.length + 1}`, runId: run.id, done }
    sessions.push(session)
    return { sessionId: session.sessionId, harnessSessionId: session.sessionId, runId: run.id, waitForCompletion: () => done.promise }
  })
  return {
    sessions,
    adapter: {
      spawn,
      kill: vi.fn(async (sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed') => {
        const session = sessions.find((item) => item.sessionId === sessionId)
        session?.done.resolve({
          exitReason: reason === 'cancelled' ? 'killed' : reason,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        })
      }),
      isAlive: vi.fn(async () => true),
    } satisfies HarnessAdapter,
  }
}

export function createFixture(
  options: {
    realWatcherManager?: boolean
    now?: string
    pollIntervalMs?: number
    resolveRepoPath?: (repoName: string) => string | undefined
    postCompletion?: PostCompletionConfig
    worktreeManager?: WorktreeManager
    recordEvidence?: boolean
    validateWorkflowProfile?: (profile: RunWorkflowProfileSnapshot) => WorkflowProfileRuntimeData
    preDispatchCheck?: (task: Task, agent: Agent) => PrerequisiteIssue[]
    seedWorkflowStage?: (runId: Run['id'], stage: WorkflowStage) => Promise<void> | void
    maxTaskRetries?: number
  } = {},
) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, reviewer, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const nowRef = { value: options.now ?? '2026-04-04T12:00:00.000Z' }
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter, {
    now: () => new Date(nowRef.value),
    runCheckpointRepo: context.runCheckpointRepo,
  })
  const order: string[] = []
  const builderHarness = createAdapter('claude', order)
  const reviewerHarness = createAdapter('reviewer', order)
  const watcherManager = options.realWatcherManager
    ? new WatcherManager(context.runRepo, context.evidenceRepo, stateMachine, eventEmitter, {
        commandRunner: vi.fn(async (args: readonly string[]) =>
          args.includes('checks') ? '[]' : JSON.stringify({ reviewDecision: null, latestReviews: [] }),
        ),
      })
    : ({ stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager)
  const dispatcher = new Dispatcher(
    dag,
    context.runRepo,
    context.taskRepo,
    context.agentRepo,
    context.projectAgentRepo,
    context.specRepo,
    context.projectRepo,
    stateMachine,
    watcherManager,
    context.sessionRunMappingRepo,
    new Map([
      ['claude-agent-sdk', builderHarness.adapter],
      ['vercel-ai', reviewerHarness.adapter],
    ]),
    eventEmitter,
    {
      pollIntervalMs: options.pollIntervalMs ?? 1_000,
      maxConcurrentRuns: 3,
      now: () => new Date(nowRef.value),
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      resolveRepoPath: options.resolveRepoPath,
      preDispatchCheck: options.preDispatchCheck,
      ...(options.maxTaskRetries == null ? {} : { maxTaskRetries: options.maxTaskRetries }),
      validateWorkflowProfile: options.validateWorkflowProfile,
      createMcpServer: async (runId) => {
        order.push(`mcp:${runId}`)
        return { close: vi.fn() } satisfies DispatcherMcpServer
      },
      seedWorkflowStage: options.seedWorkflowStage,
    },
    options.worktreeManager,
    options.postCompletion,
    context.configResourceRepo,
    options.recordEvidence ? context.evidenceRepo : undefined,
    undefined,
    { repositories: context.repositoryRepo, components: context.componentRepo, targets: context.targetRepo, specs: context.specRepo },
    context.runCheckpointRepo,
    context.attemptLeaseRepo,
  )

  return { context, project, builder, reviewer, spec, nowRef, order, eventEmitter, stateMachine, watcherManager, builderHarness, reviewerHarness, dispatcher }
}

export function createTask(
  fixture: ReturnType<typeof createFixture>,
  fields: Partial<
    Pick<
      Task,
      | 'name'
      | 'assignedAgentId'
      | 'requiredRole'
      | 'complexity'
      | 'status'
      | 'repos'
      | 'repositoryId'
      | 'componentId'
      | 'strategyRole'
      | 'strategyGroup'
    >
  > = {},
): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: fields.name ?? `Task ${Math.random()}`,
    prompt: 'implement',
    repos: fields.repos ?? ['packages/core'],
    repositoryId: fields.repositoryId,
    componentId: fields.componentId,
    assignedAgentId: fields.assignedAgentId ?? null,
    requiredRole: fields.requiredRole,
    complexity: fields.complexity,
    strategyRole: fields.strategyRole,
    strategyGroup: fields.strategyGroup,
    status: fields.status ?? 'ready',
    verification: ['pnpm test'],
  })
}

export async function flush() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}


/**
 * Seed an implementation run on task `name` with a worktree already
 * set up. Mimics the state after a successful impl dispatch+completion.
 */
export function seedImplRun(
  fixture: ReturnType<typeof createFixture>,
  name: string,
  opts: {
    worktree?: string
    terminalState?: Run['terminalState']
    createdAt?: string
    lastHeartbeat?: string
    heartbeatTimeoutSeconds?: number
    branch?: string
    commitSha?: string
  } = {},
): { task: Task; run: Run } {
  // status='active' so cycle() skips it — we've already "dispatched" it.
  const task = createTask(fixture, { name, status: 'active', assignedAgentId: fixture.builder.id })
  const run = fixture.context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: fixture.builder.id,
    parentRunId: null,
    stage: 'implement',
    terminalState: opts.terminalState ?? null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'impl-session',
    branch: opts.branch ?? null,
    commitSha: opts.commitSha ?? null,
    prNumber: null,
    prUrl: null,
    worktreePaths: opts.worktree != null ? [opts.worktree] : null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: opts.lastHeartbeat ?? fixture.nowRef.value,
    heartbeatTimeoutSeconds: opts.heartbeatTimeoutSeconds ?? 120,
  })
  return { task, run }
}
