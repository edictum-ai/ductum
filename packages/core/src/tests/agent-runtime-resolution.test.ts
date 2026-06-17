import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Agent, type ProjectId, type Run, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  vi.useRealTimers()
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createAdapter(name: string) {
  const sessions: Array<{ sessionId: string; done: ReturnType<typeof deferred<HarnessSessionResult>> }> = []
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    const done = deferred<HarnessSessionResult>()
    const session = { sessionId: `${name}-session-${sessions.length + 1}`, done }
    sessions.push(session)
    return { sessionId: session.sessionId, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { sessions, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createFixture(options: { omitConfigResourceRepo?: boolean } = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const nowRef = { value: '2026-04-04T12:00:00.000Z' }
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter, {
    now: () => new Date(nowRef.value),
  })
  const claude = createAdapter('claude')
  const codex = createAdapter('codex')
  const reviewer = createAdapter('reviewer')
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
    new Map([
      ['claude-agent-sdk', claude.adapter],
      ['codex-sdk', codex.adapter],
      ['vercel-ai', reviewer.adapter],
    ]),
    eventEmitter,
    {
      pollIntervalMs: 1_000,
      maxConcurrentRuns: 3,
      now: () => new Date(nowRef.value),
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
    },
    undefined,
    undefined,
    options.omitConfigResourceRepo ? undefined : context.configResourceRepo,
  )
  return { context, project, spec, builder, nowRef, claude, codex, dispatcher }
}

function createTask(fixture: ReturnType<typeof createFixture>, fields: Partial<Pick<Task, 'status' | 'assignedAgentId'>> = {}) {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Runtime refs',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fields.assignedAgentId ?? fixture.builder.id,
    status: fields.status ?? 'ready',
    verification: ['pnpm test'],
  })
}

function createModel(context: RepoContext, name: string, modelId: string, projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Model',
    projectId,
    name,
    spec: { provider: 'openai', modelId },
  })
}

function createHarness(context: RepoContext, name: string, type: string, projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'Harness',
    projectId,
    name,
    spec: { type },
  })
}

function otherProject(fixture: ReturnType<typeof createFixture>) {
  return fixture.context.projectRepo.create({
    id: createId<'ProjectId'>(),
    factoryId: fixture.project.factoryId,
    name: `other-${Math.random()}`,
    repos: [],
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
}

function activeRun(fixture: ReturnType<typeof createFixture>, task: Task, runtime: Partial<Pick<Run, 'runtimeModel' | 'runtimeHarness'>> = {}) {
  return fixture.context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: fixture.builder.id,
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'ended-session',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: fixture.nowRef.value,
    heartbeatTimeoutSeconds: 120,
    ...runtime,
  })
}

async function finishRun(fixture: ReturnType<typeof createFixture>, run: Run) {
  await (fixture.dispatcher as unknown as {
    handleSessionEnd(runId: Run['id'], result: HarnessSessionResult): Promise<void>
  }).handleSessionEnd(run.id, { exitReason: 'completed', tokensIn: 5, tokensOut: 2, costUsd: 0 })
}

describe('Agent runtime ref resolution', () => {
  it('uses resolved model and harness refs for dispatch, mapping, and run snapshots', async () => {
    const fixture = createFixture()
    createModel(fixture.context, 'runtime-gpt', '  gpt-5.4  ')
    createHarness(fixture.context, 'runtime-codex', '  codex-sdk  ')
    fixture.context.agentRepo.update(fixture.builder.id, {
      model: 'legacy-model',
      harness: 'claude-agent-sdk',
      resourceRefs: { modelRef: 'runtime-gpt', harnessRef: 'runtime-codex' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
    expect(fixture.codex.adapter.spawn.mock.calls[0]?.[4]?.agent).toMatchObject({ model: 'gpt-5.4', harness: 'codex-sdk' })
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toMatchObject({ harness: 'codex-sdk' })
    expect(run).toMatchObject({ runtimeModel: 'gpt-5.4', runtimeHarness: 'codex-sdk' })
  })

  it.each([
    ['unknown modelRef', { modelRef: 'missing-model' }, null, 'modelRef not found: missing-model'],
    ['wrong-kind modelRef', { modelRef: 'not-a-model' }, (f: ReturnType<typeof createFixture>) => createHarness(f.context, 'not-a-model', 'codex-sdk'), 'references Harness, expected Model'],
    ['cross-project modelRef', { modelRef: 'other-model' }, (f: ReturnType<typeof createFixture>) => createModel(f.context, 'other-model', 'gpt-5.4', otherProject(f).id), 'outside the run project'],
    ['unknown harnessRef', { harnessRef: 'missing-harness' }, null, 'harnessRef not found: missing-harness'],
    ['wrong-kind harnessRef', { harnessRef: 'not-a-harness' }, (f: ReturnType<typeof createFixture>) => createModel(f.context, 'not-a-harness', 'gpt-5.4'), 'references Model, expected Harness'],
    ['cross-project harnessRef', { harnessRef: 'other-harness' }, (f: ReturnType<typeof createFixture>) => createHarness(f.context, 'other-harness', 'codex-sdk', otherProject(f).id), 'outside the run project'],
  ] as const)('rejects %s before creating a run', async (_name, refs, setup, expected) => {
    const fixture = createFixture()
    setup?.(fixture)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: refs })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain(expected)
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
  })

  it('rejects malformed resources and unsupported harness adapters before creating a run', async () => {
    for (const [refs, makeResource, expected] of [
      [{ modelRef: 'bad-model' }, (f: ReturnType<typeof createFixture>) => f.context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'bad-model', spec: { provider: 'openai' } as never }), 'without provider model ID spec.modelId'],
      [{ harnessRef: 'bad-harness' }, (f: ReturnType<typeof createFixture>) => f.context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'bad-harness', spec: { command: 'codex' } as never }), 'without Harness adapter type spec.type'],
      [{ harnessRef: 'unknown-adapter' }, (f: ReturnType<typeof createFixture>) => createHarness(f.context, 'unknown-adapter', 'not-a-real-adapter'), 'resolved to unsupported harness: not-a-real-adapter'],
    ] as const) {
      const fixture = createFixture()
      makeResource(fixture)
      fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: refs })
      const task = createTask(fixture)

      const result = await fixture.dispatcher.cycle()

      expect(result.errors[0]?.error).toContain(expected)
      expect(fixture.context.runRepo.list(task.id)).toEqual([])
      expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
    }
  })

  it('prefers project resources over factory resources with the same name', async () => {
    const fixture = createFixture()
    createModel(fixture.context, 'shared-model', 'factory-model')
    createModel(fixture.context, 'shared-model', 'project-model', fixture.project.id)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { modelRef: 'shared-model' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors).toEqual([])
    expect(result.tasksDispatched).toEqual([task.id])
    expect(fixture.context.runRepo.list(task.id)[0]?.runtimeModel).toBe('project-model')
    expect(fixture.claude.adapter.spawn.mock.calls[0]?.[4]?.agent?.model).toBe('project-model')
  })

  it('re-resolves resources each dispatch but uses run snapshots after dispatch', async () => {
    const fixture = createFixture()
    const resource = createModel(fixture.context, 'mutable-model', 'gpt-5.4')
    fixture.context.agentRepo.update(fixture.builder.id, { model: 'legacy-model', resourceRefs: { modelRef: 'mutable-model' } })
    const firstTask = createTask(fixture)

    await fixture.dispatcher.cycle()
    fixture.claude.sessions[0]?.done.resolve({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await Promise.resolve()
    await Promise.resolve()
    fixture.context.configResourceRepo.update(resource.id, { spec: { provider: 'openai', modelId: 'claude-opus-4.6' } })
    const secondTask = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.context.configResourceRepo.delete(resource.id)
    fixture.claude.sessions[1]?.done.resolve({ exitReason: 'completed', tokensIn: 7, tokensOut: 3, costUsd: 0 })
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.claude.adapter.spawn.mock.calls[0]?.[4]?.agent?.model).toBe('gpt-5.4')
    expect(fixture.claude.adapter.spawn.mock.calls[1]?.[4]?.agent?.model).toBe('claude-opus-4.6')
    expect(fixture.context.runRepo.list(firstTask.id)).toHaveLength(1)
    expect(fixture.context.runRepo.list(secondTask.id)[0]?.costUsd).toBeCloseTo(0.000110, 8)
  })

  it('fails loudly when refs exist but dispatcher has no config resource repo', async () => {
    const fixture = createFixture({ omitConfigResourceRepo: true })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { modelRef: 'runtime-gpt' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors[0]?.error).toContain('has runtime refs but dispatcher has no config resource repo')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  })

  it('marks manual dispatch tasks failed when runtime refs are invalid pre-run', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { modelRef: 'missing-model' } })
    const task = createTask(fixture)
    await expect(fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)).rejects.toThrow('modelRef not found: missing-model')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  })

  it('uses persisted run snapshots and never falls back to legacy model when refs disappear', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, { model: 'claude-opus-4.6', resourceRefs: { modelRef: 'deleted-model' } })
    const snapshotTask = createTask(fixture, { status: 'active', assignedAgentId: fixture.builder.id })
    await finishRun(fixture, activeRun(fixture, snapshotTask, { runtimeModel: 'claude-opus-4.6', runtimeHarness: 'claude-agent-sdk' }))
    const noSnapshotTask = createTask(fixture, { status: 'active', assignedAgentId: fixture.builder.id })
    await finishRun(fixture, activeRun(fixture, noSnapshotTask))
    const changedResource = createModel(fixture.context, 'changed-model', 'gpt-5.4')
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { modelRef: 'changed-model' } })
    fixture.context.configResourceRepo.update(changedResource.id, { spec: { provider: 'openai', modelId: 'claude-opus-4.6' } })
    const changedTask = createTask(fixture, { status: 'active', assignedAgentId: fixture.builder.id })
    await finishRun(fixture, activeRun(fixture, changedTask))
    expect(fixture.context.runRepo.list(snapshotTask.id)[0]?.costUsd).toBeCloseTo(0.000075, 8)
    expect(fixture.context.runRepo.list(noSnapshotTask.id)[0]?.costUsd).toBe(0)
    expect(fixture.context.runRepo.list(changedTask.id)[0]?.costUsd).toBe(0)
  })
})
