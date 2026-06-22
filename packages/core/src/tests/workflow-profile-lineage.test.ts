import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherConfig, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type RunWorkflowProfileSnapshot } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { applyWorkflowProfileRuntimeData } from '../workflow-profile-runtime.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: RepoContext[] = []

afterEach(() => {
  for (const context of cleanup.splice(0)) context.db.close()
})

function createAdapter() {
  const resolvers = new Map<string, (result: HarnessSessionResult) => void>()
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    const sessionId = `session-${run.id}`
    const wait = new Promise<HarnessSessionResult>((resolve) => {
      resolvers.set(sessionId, resolve)
    })
    return { sessionId, runId: run.id, waitForCompletion: () => wait }
  })
  const kill = vi.fn(async (sessionId: string, reason: 'killed' | 'completed' | 'cancelled' = 'killed') => {
    resolvers.get(sessionId)?.({
      exitReason: reason === 'cancelled' ? 'killed' : reason,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
  })
  return { spawn, resolvers, adapter: { spawn, kill, isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  await new Promise<void>((resolve) => setImmediate(resolve))
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

function createDispatcher(
  context: RepoContext,
  adapter: HarnessAdapter,
  events: DuctumEventEmitter,
  config: DispatcherConfig,
) {
  return new Dispatcher(
    new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, events),
    context.runRepo,
    context.taskRepo,
    context.agentRepo,
    context.projectAgentRepo,
    context.specRepo,
    context.projectRepo,
    new RunStateMachine(context.runRepo, context.runStageHistoryRepo, events),
    { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager,
    context.sessionRunMappingRepo,
    new Map([['claude-agent-sdk', adapter], ['vercel-ai', adapter]]),
    events,
    {
      maxConcurrentRuns: 3,
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }),
      resolveRepoPath: () => '/repo/ductum',
      ...config,
    },
    undefined,
    undefined,
    context.configResourceRepo,
    context.evidenceRepo,
  )
}

describe('WorkflowProfile lineage runtime', () => {
  it('fix and review runs inherit the parent materialized workflow snapshot instead of re-resolving mutable refs', async () => {
    const context = createRepoContext()
    cleanup.push(context)
    const { project, builder, reviewer, spec } = seedBase(context)
    const events = new DuctumEventEmitter()
    const adapter = createAdapter()
    const validateWorkflowProfile = vi.fn(() => { throw new Error('should not re-render') })
    const resolveSetupCommands = vi.fn((_projectName: string, profile?: RunWorkflowProfileSnapshot) =>
      profile?.setupCommands)
    const parentSnapshot: RunWorkflowProfileSnapshot = {
      id: createId<'ConfigResourceId'>(),
      name: 'parent-workflow',
      projectId: project.id,
      path: '/tmp/parent-profile.yaml',
      renderedWorkflow: 'apiVersion: edictum/v1alpha1\nkind: Workflow\nstages: []\n',
      setupCommands: ['setup:parent'],
      verifyCommands: ['verify:parent'],
    }
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'changed-workflow',
      spec: { path: '/tmp/changed-profile.yaml' },
    })
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'changed-workflow' } })
    const implTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'P1',
      prompt: 'implement',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'done',
      verification: ['pnpm test'],
    })
    const parentRun = context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: implTask.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'ship'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'impl-session',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/impl-worktree'],
      runtimeWorkflowProfile: parentSnapshot,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    })
    const fixTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-P1-r1',
      prompt: 'fix',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'ready',
      verification: ['pnpm test'],
    })
    const reviewTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-P1-r1',
      prompt: 'review',
      repos: ['packages/core'],
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'ready',
      verification: ['pnpm test'],
    })
    const dispatcher = createDispatcher(context, adapter.adapter, events, {
      resolveSetupCommands,
      validateWorkflowProfile,
    })

    // Cycle 1: fix-P1-r1 dispatches. No active session in lineage P1 yet.
    const result1 = await dispatcher.cycle()
    expect(result1.errors).toEqual([])
    expect(result1.tasksDispatched).toEqual([fixTask.id])
    const fixRun = context.runRepo.list(fixTask.id)[0]!

    // End the fix session so the lineage lock for P1 is released.
    // Without this, review-P1-r1 would be blocked in the next cycle.
    await adapter.adapter.kill(`session-${fixRun.id}`, 'completed')
    await flush()

    // Cycle 2: review-P1-r1 dispatches now that the P1 lineage is free.
    const result2 = await dispatcher.cycle()
    expect(result2.errors).toEqual([])
    expect(result2.tasksDispatched).toEqual([reviewTask.id])
    const reviewRun = context.runRepo.list(reviewTask.id)[0]!

    expect(fixRun.parentRunId).toBe(parentRun.id)
    expect(reviewRun.parentRunId).toBe(fixRun.id)
    expect(fixRun.runtimeWorkflowProfile).toEqual(parentSnapshot)
    expect(reviewRun.runtimeWorkflowProfile).toEqual(parentSnapshot)
    expect(validateWorkflowProfile).not.toHaveBeenCalled()
    expect(resolveSetupCommands).toHaveBeenCalledWith(project.name, parentSnapshot)
    expect(adapter.spawn.mock.calls[0]?.[0].runtimeWorkflowProfile).toEqual(parentSnapshot)
    expect(adapter.spawn.mock.calls[1]?.[0].runtimeWorkflowProfile).toEqual(parentSnapshot)
    expect(adapter.spawn.mock.calls[0]?.[4]?.workingDir).toBe('/tmp/impl-worktree')
    expect(adapter.spawn.mock.calls[1]?.[4]?.workingDir).toBe('/tmp/impl-worktree')
  })

  it('rejects path-only parent workflow snapshots before creating a fix run', async () => {
    const context = createRepoContext()
    cleanup.push(context)
    const { builder, spec } = seedBase(context)
    const events = new DuctumEventEmitter()
    const adapter = createAdapter()
    const implTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'P1',
      prompt: 'implement',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      status: 'done',
      verification: ['pnpm test'],
    })
    context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: implTask.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'impl-session',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/impl-worktree'],
      runtimeWorkflowProfile: {
        id: createId<'ConfigResourceId'>(),
        name: 'path-only',
        projectId: null,
        path: '/tmp/path-only.yaml',
      },
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    })
    const fixTask = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-P1-r1',
      prompt: 'fix',
      repos: ['packages/core'],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'ready',
      verification: ['pnpm test'],
    })
    const dispatcher = createDispatcher(context, adapter.adapter, events, {})

    const result = await dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('missing materialized renderedWorkflow')
    expect(context.runRepo.list(fixTask.id)).toEqual([])
    expect(adapter.spawn).not.toHaveBeenCalled()
  })

  it('rejects empty materialized verification commands', () => {
    expect(() => applyWorkflowProfileRuntimeData(
      { id: createId<'ConfigResourceId'>(), name: 'empty-verify', projectId: null, path: '/tmp/profile.yaml' },
      { renderedWorkflow: 'rendered', setupCommands: [], verifyCommands: [] },
    )).toThrow('empty materialized verifyCommands')
  })
})
