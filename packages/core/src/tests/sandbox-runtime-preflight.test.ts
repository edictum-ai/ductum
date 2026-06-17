import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { resolveAgentSandboxProfileDetails } from '../agent-runtime-resolution.js'
import type { ConfigResource } from '../resource-types.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type ProjectId, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
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

function createAdapter() {
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    const done = deferred<HarnessSessionResult>()
    return { sessionId: `session-${run.id}`, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { spawn, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createFixture(options: { omitConfigResourceRepo?: boolean } = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const now = () => new Date('2026-04-04T12:00:00.000Z')
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter, { now })
  const claude = createAdapter()
  const watcherManager = { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager
  const worktreeManager = {
    enabled: true,
    isGitRepo: vi.fn(() => true),
    create: vi.fn(async () => '/tmp/ductum-worktree'),
  } as never
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
    new Map([['claude-agent-sdk', claude.adapter]]),
    eventEmitter,
    {
      pollIntervalMs: 1_000,
      maxConcurrentRuns: 3,
      now,
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
      resolveRepoPath: () => '/repo/ductum',
    },
    worktreeManager,
    undefined,
    options.omitConfigResourceRepo ? undefined : context.configResourceRepo,
  )
  return { context, project, spec, builder, claude, dispatcher }
}

function createTask(fixture: ReturnType<typeof createFixture>) {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Sandbox preflight',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

function createSandbox(
  context: RepoContext,
  name: string,
  projectId: ProjectId | null = null,
  spec: ConfigResource['spec'] = { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readWrite' } },
) {
  return context.configResourceRepo.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId,
    name,
    spec,
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

describe('sandbox runtime preflight', () => {
  it.each([
    ['missing sandboxRef', null, 'sandboxRef not found: missing-sandbox'],
    ['wrong-kind sandboxRef', (f: ReturnType<typeof createFixture>) => f.context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'missing-sandbox', spec: { provider: 'openai', modelId: 'gpt-5.4' } }), 'references Model, expected SandboxProfile'],
    ['cross-project sandboxRef', (f: ReturnType<typeof createFixture>) => createSandbox(f.context, 'missing-sandbox', otherProject(f).id), 'outside the run project'],
    ['unsupported runtime sandboxRef', (f: ReturnType<typeof createFixture>) => createSandbox(f.context, 'missing-sandbox', f.project.id, { provider: 'docker', mode: 'container' }), 'unsupported sandbox runtime docker/container'],
  ] as const)('rejects %s before creating a run or spawning a session', async (_name, setup, expected) => {
    const fixture = createFixture()
    setup?.(fixture)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'missing-sandbox' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain(expected)
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.claude.spawn).not.toHaveBeenCalled()
  })

  it.each([
    [{ mode: 'worktree' }, 'without spec.provider'],
    [{ provider: 'host' }, 'without spec.mode'],
  ] as const)('rejects malformed sandbox profiles before creating a run', async (spec, expected) => {
    const fixture = createFixture()
    createSandbox(fixture.context, 'bad-sandbox', null, spec as never)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'bad-sandbox' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

	    expect(result.errors[0]?.error).toContain(expected)
	    expect(fixture.context.runRepo.list(task.id)).toEqual([])
	    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
	    expect(fixture.claude.spawn).not.toHaveBeenCalled()
	  })

	  it('snapshots the resolved sandbox profile on the run before spawn', async () => {
	    const fixture = createFixture()
	    const sandbox = createSandbox(fixture.context, 'host-worktree', fixture.project.id)
	    const redactionSandbox = createSandbox(fixture.context, 'redacted-worktree', fixture.project.id, {
	      provider: 'host',
	      mode: 'worktree',
	      network: {
	        mode: 'none',
	        headers: {
	          Authorization: 'Bearer secret-token',
	          accessToken: 'nested-token',
	          clientSecret: 'nested-secret',
	          'X-Trace': 'keep',
	        },
	      },
	      credentials: { expose: ['secret-token'] },
	      resources: {
	        cpu: 2,
	        token: 'resource-secret',
	        privateKey: 'resource-private-key',
	        session_key: 'resource-session-key',
	      },
	    })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'host-worktree' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

	    expect(result.errors).toEqual([])
	    expect(fixture.claude.spawn).toHaveBeenCalledOnce()
	    expect(fixture.claude.spawn.mock.calls[0]?.[0].runtimeSandboxProfile).toMatchObject({
	      id: sandbox.id,
	      name: 'host-worktree',
	    })
	    expect(run.runtimeSandboxProfile).toMatchObject({
      id: sandbox.id,
      name: 'host-worktree',
      projectId: fixture.project.id,
      provider: 'host',
      mode: 'worktree',
    })
	    expect(run.runtimeSandboxProfile?.spec).toEqual({
	      provider: 'host',
	      mode: 'worktree',
	      filesystem: { worktree: 'readWrite' },
	    })
	    expect(resolveAgentSandboxProfileDetails(
	      { name: 'mimi', resourceRefs: { sandboxRef: 'redacted-worktree' } },
	      fixture.project.id,
	      fixture.context.configResourceRepo,
	    ).profile.spec).toEqual({
	      provider: 'host',
	      mode: 'worktree',
	      network: { mode: 'none', headers: { 'X-Trace': 'keep' } },
	      resources: { cpu: 2 },
	    })
	  })

  it('uses project-scoped sandbox profiles before same-name factory profiles', async () => {
    const fixture = createFixture()
    createSandbox(fixture.context, 'shared-sandbox', null)
    createSandbox(fixture.context, 'shared-sandbox', fixture.project.id)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'shared-sandbox' } })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()

    expect(fixture.context.runRepo.list(task.id)[0]?.runtimeSandboxProfile).toMatchObject({
      projectId: fixture.project.id,
      mode: 'worktree',
    })
  })

  it('allows factory-scoped sandbox profiles for any project', async () => {
    const fixture = createFixture()
    createSandbox(fixture.context, 'factory-sandbox')
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'factory-sandbox' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors).toEqual([])
    expect(fixture.context.runRepo.list(task.id)[0]?.runtimeSandboxProfile).toMatchObject({
      projectId: null,
      name: 'factory-sandbox',
    })
  })

  it('rejects ambiguous sandbox refs from the shared resolver', () => {
    const first = sandboxResource('dupe')
    const second = sandboxResource('dupe')

    expect(() => resolveAgentSandboxProfileDetails(
      { name: 'mimi', resourceRefs: { sandboxRef: 'dupe' } },
      null,
      { get: () => null, list: () => [first, second] },
    )).toThrow('sandboxRef "dupe" is ambiguous in factory scope')
  })

  it('rejects ambiguous project-scoped sandbox refs from the shared resolver', () => {
    const projectId = createId<'ProjectId'>()
    const first = sandboxResource('dupe', projectId)
    const second = sandboxResource('dupe', projectId)

    expect(() => resolveAgentSandboxProfileDetails(
      { name: 'mimi', resourceRefs: { sandboxRef: 'dupe' } },
      projectId,
      { get: () => null, list: () => [first, second] },
    )).toThrow('sandboxRef "dupe" is ambiguous in project scope')
  })

  it('keeps legacy no-ref dispatch unchanged without a config resource repo', async () => {
    const fixture = createFixture({ omitConfigResourceRepo: true })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([task.id])
    expect(result.errors).toEqual([])
    expect(run.runtimeSandboxProfile).toBeNull()
    expect(fixture.claude.spawn.mock.calls[0]?.[4]?.agent?.resourceRefs?.sandboxRef).toBeUndefined()
  })

  it('does not silently fall back to no sandbox when only sandboxRef is bad', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { sandboxRef: 'ghost' } })
    const task = createTask(fixture)

    await expect(fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)).rejects.toThrow('sandboxRef not found: ghost')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.claude.spawn).not.toHaveBeenCalled()
  })
})

function sandboxResource(name: string, projectId: ProjectId | null = null): ConfigResource {
  return {
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId,
    name,
    spec: { provider: 'host', mode: 'worktree' },
    createdAt: '2026-04-04T12:00:00.000Z',
    updatedAt: '2026-04-04T12:00:00.000Z',
  }
}
