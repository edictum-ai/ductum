import { mkdirSync, rmSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import type { ConfigResource } from '../resource-types.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type ProjectId, type Run, type Task } from '../types.js'
import type { WatcherManager } from '../watcher-manager.js'
import type { WorktreeManager } from '../worktree.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createAdapter(order: string[]) {
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    order.push('spawn')
    const done = deferred<HarnessSessionResult>()
    return { sessionId: `session-${run.id}`, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { spawn, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createWorktreeManager(options: { enabled?: boolean; createPath?: string | ((repo: string) => string); git?: boolean } = {}) {
  const createPath = options.createPath ?? '/tmp/ductum-worktree'
  return {
    enabled: options.enabled ?? true,
    cleanupOnSuccess: true,
    cleanupOnFailure: true,
    isGitRepo: vi.fn(() => options.git ?? true),
    create: vi.fn(async (repoPath: string) => typeof createPath === 'function' ? createPath(repoPath) : createPath),
    remove: vi.fn(),
    cleanupStale: vi.fn(async () => 0),
  } as unknown as WorktreeManager
}

function createFixture(options: {
  worktreeManager?: WorktreeManager
  resolveRepoPath?: (repoName: string) => string | undefined
} = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const now = () => new Date('2026-04-04T12:00:00.000Z')
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter, { now })
  const order: string[] = []
  const harness = createAdapter(order)
  const watcherManager = { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager
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
    new Map([['claude-agent-sdk', harness.adapter]]),
    eventEmitter,
    {
      pollIntervalMs: 1_000,
      maxConcurrentRuns: 3,
      now,
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
      resolveRepoPath: options.resolveRepoPath ?? (() => '/repo/ductum'),
    },
    options.worktreeManager,
    undefined,
    context.configResourceRepo,
    context.evidenceRepo,
  )
  return { context, project, spec, builder, harness, order, dispatcher }
}

function createTask(fixture: ReturnType<typeof createFixture>, fields: Partial<Pick<Task, 'name' | 'status' | 'requiredRole'>> = {}) {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: fields.name ?? 'Sandbox runtime',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    requiredRole: fields.requiredRole,
    status: fields.status ?? 'ready',
    verification: ['pnpm test'],
  })
}

function createSandbox(context: RepoContext, spec: ConfigResource['spec'], projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId,
    name: 'builder-worktree',
    spec,
  })
}

function useSandbox(fixture: ReturnType<typeof createFixture>, spec: ConfigResource['spec'] = { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readWrite' } }) {
  const sandbox = createSandbox(fixture.context, spec)
  fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: sandbox.name } })
  return sandbox
}

describe('sandbox runtime driver', () => {
  it('prepares host/worktree runtime, passes spawn metadata, and records evidence before spawn', async () => {
    const fixture = createFixture({ worktreeManager: createWorktreeManager({ createPath: '/tmp/wt/run-1' }) })
    const createEvidence = fixture.context.evidenceRepo.create.bind(fixture.context.evidenceRepo)
    vi.spyOn(fixture.context.evidenceRepo, 'create').mockImplementation((evidence) => {
      fixture.order.push('evidence')
      return createEvidence(evidence)
    })
    const sandbox = useSandbox(fixture)
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    const spawnOptions = fixture.harness.spawn.mock.calls[0]?.[4]
    const evidence = fixture.context.evidenceRepo.list(run.id)

    expect(result.errors).toEqual([])
    expect(fixture.order).toEqual(['evidence', 'spawn', 'evidence'])
    expect(run.worktreePaths).toEqual(['/tmp/wt/run-1'])
    expect(spawnOptions).toMatchObject({
      workingDir: '/tmp/wt/run-1',
      sandbox: {
        driver: 'host',
        profile: { id: sandbox.id, name: sandbox.name, provider: 'host', mode: 'worktree' },
        workingDir: '/tmp/wt/run-1',
        worktreePaths: ['/tmp/wt/run-1'],
        boundary: {
          filesystem: 'worktree-readWrite',
          network: 'host',
          credentials: 'host',
          resources: 'none',
          process: 'host',
        },
      },
    })
    expect(evidence[0]?.payload).toMatchObject({ kind: 'runtime.sandbox.prepared', agentExecution: { mode: 'host', hostProcess: true }, sandbox: { driver: 'host', boundary: { credentials: '[redacted]' } } })
  })

  it('preserves legacy no-ref worktree behavior without sandbox metadata', async () => {
    const worktreeManager = createWorktreeManager({ createPath: '/tmp/wt/legacy' })
    const fixture = createFixture({ worktreeManager })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(run.runtimeSandboxProfile).toBeNull()
    expect(run.worktreePaths).toEqual(['/tmp/wt/legacy'])
    expect(fixture.harness.spawn.mock.calls[0]?.[4]?.sandbox).toBeUndefined()
    expect(fixture.context.evidenceRepo.list(run.id)).toEqual([])
  })

  it('reuses an inherited worktree for sandbox runtime without creating a new one', async () => {
    const worktreeManager = createWorktreeManager()
    const fixture = createFixture({ worktreeManager })
    const createEvidence = fixture.context.evidenceRepo.create.bind(fixture.context.evidenceRepo)
    vi.spyOn(fixture.context.evidenceRepo, 'create').mockImplementation((evidence) => {
      fixture.order.push('evidence')
      return createEvidence(evidence)
    })
    const parentPath = `/tmp/ductum-parent-${createId<'RunId'>()}`
    mkdirSync(parentPath, { recursive: true })
    cleanup.push({ close: () => rmSync(parentPath, { recursive: true, force: true }) })
    useSandbox(fixture)
    const implTask = createTask(fixture, { name: 'P1', status: 'done' })
    fixture.context.runRepo.create(baseRun(implTask, fixture.builder.id, [parentPath]))
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    const result = await fixture.dispatcher.cycle()
    const spawnOptions = fixture.harness.spawn.mock.calls[0]?.[4]

    expect(result.errors).toEqual([])
    expect(fixture.order).toEqual(['evidence', 'spawn', 'evidence'])
    expect(worktreeManager.create).not.toHaveBeenCalled()
    expect(spawnOptions?.workingDir).toBe(parentPath)
    expect(spawnOptions?.sandbox).toMatchObject({ reusedWorktree: true, worktreePaths: [parentPath] })
    expect(fixture.context.runRepo.list(reviewTask.id)[0]?.parentRunId).toBeDefined()
  })

  it.each([
    ['empty', '', 'requires a non-empty inherited worktree path'],
    ['missing', '/tmp/ductum-missing-parent', 'inherited worktree path no longer exists'],
  ] as const)('rejects an inherited sandbox worktree path that is %s', async (_name, path, expected) => {
    const fixture = createFixture({ worktreeManager: createWorktreeManager() })
    useSandbox(fixture)
    const implTask = createTask(fixture, { name: 'P1', status: 'done' })
    fixture.context.runRepo.create(baseRun(implTask, fixture.builder.id, [path]))
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    const result = await fixture.dispatcher.cycle()

    expect(result.errors[0]?.error).toContain(expected)
    expect(fixture.context.runRepo.list(reviewTask.id)).toEqual([])
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['docker provider', { provider: 'docker', mode: 'bindMount' }, 'unsupported sandbox runtime docker/bindMount'],
    ['read-only worktree', { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readOnly' } }, 'filesystem.worktree=readOnly'],
    ['extra mount', { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readWrite', extraMounts: ['/tmp'] } }, 'filesystem.extraMounts'],
    ['network none', { provider: 'host', mode: 'worktree', network: { mode: 'none' } }, 'network.mode=none'],
    ['credentials', { provider: 'host', mode: 'worktree', credentials: { expose: ['github'] } }, 'spec.credentials'],
    ['resources', { provider: 'host', mode: 'worktree', resources: { cpu: 2 } }, 'spec.resources'],
    ['process', { provider: 'host', mode: 'worktree', process: { uid: 1000 } }, 'spec.process'],
  ] as const)('rejects unsupported sandbox runtime claim: %s', async (_name, spec, expected) => {
    const fixture = createFixture({ worktreeManager: createWorktreeManager() })
    useSandbox(fixture, spec as never)
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain(expected)
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy dispatch when configured sandbox lacks a worktree manager', async () => {
    const fixture = createFixture()
    useSandbox(fixture)
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors[0]?.error).toContain('requires an enabled Ductum worktree manager')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['repo path fallback', (repo: string) => repo],
    ['empty path', () => ''],
  ] as const)('does not create a session mapping when worktree creation returns %s', async (_name, createPath) => {
    const fixture = createFixture({ worktreeManager: createWorktreeManager({ createPath }) })
    useSandbox(fixture)
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('failed to create a Ductum-managed worktree')
    expect(run.terminalState).toBe('stalled')
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toBeNull()
  })
})

function baseRun(task: Task, agentId: Run['agentId'], worktreePaths: string[]) {
  return {
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'done',
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
    worktreePaths,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-04T12:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
  } satisfies Parameters<RepoContext['runRepo']['create']>[0]
}
