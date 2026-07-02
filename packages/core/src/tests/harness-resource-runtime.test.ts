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
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createAdapter(name: string, order: string[] = []) {
  const sessions: Array<{ sessionId: string; done: ReturnType<typeof deferred<HarnessSessionResult>> }> = []
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    order.push(`${name}:spawn`)
    const done = deferred<HarnessSessionResult>()
    const session = { sessionId: `${name}-session-${sessions.length + 1}`, done }
    sessions.push(session)
    return { sessionId: session.sessionId, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { sessions, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createFixture(options: { materializeAgentEnv?: (agent: Agent, context: { runId: import('../types.js').RunId; agentId: import('../types.js').AgentId }) => { env: Record<string, string>; droppedKeys: string[] } } = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
  const order: string[] = []
  const claude = createAdapter('claude', order)
  const codex = createAdapter('codex', order)
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
    new Map([['claude-agent-sdk', claude.adapter], ['codex-sdk', codex.adapter]]),
    eventEmitter,
    {
      maxConcurrentRuns: 3,
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
      materializeAgentEnv: options.materializeAgentEnv,
    },
    undefined,
    undefined,
    context.configResourceRepo,
    context.evidenceRepo,
  )
  return { context, project, builder, spec, order, claude, codex, dispatcher }
}

function createTask(fixture: ReturnType<typeof createFixture>): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Harness resource runtime',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

function createHarness(context: RepoContext, name: string, spec: unknown, projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId, name, spec: spec as never })
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

async function expectPreRunFailure(
  setup: (fixture: ReturnType<typeof createFixture>) => void,
  expected: string,
) {
  const fixture = createFixture()
  setup(fixture)
  const task = createTask(fixture)

  const result = await fixture.dispatcher.cycle()

  expect(result.tasksDispatched).toEqual([])
  expect(result.errors[0]?.error).toContain(expected)
  expect(fixture.context.runRepo.list(task.id)).toEqual([])
  expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
  expect(fixture.codex.adapter.spawn).not.toHaveBeenCalled()
}

describe('Harness resource runtime', () => {
  it('dispatches through the referenced Harness resource and records audit evidence before spawn', async () => {
    const fixture = createFixture()
    const createEvidence = fixture.context.evidenceRepo.create.bind(fixture.context.evidenceRepo)
    const evidenceCreate = vi.spyOn(fixture.context.evidenceRepo, 'create')
    const mappingCreate = vi.spyOn(fixture.context.sessionRunMappingRepo, 'create')
    evidenceCreate.mockImplementation((evidence) => {
      fixture.order.push('evidence:create')
      return createEvidence(evidence)
    })
    const harness = createHarness(fixture.context, 'runtime-codex', {
      type: ' codex-sdk ',
      command: ' codex ',
      controlMode: ' managed ',
      supportedSandboxes: [' host ', 'container'],
    })
    fixture.context.agentRepo.update(fixture.builder.id, {
      harness: 'claude-agent-sdk',
      resourceRefs: { harnessRef: 'runtime-codex' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    const evidence = fixture.context.evidenceRepo.list(run.id)

    expect(result.errors).toEqual([])
    expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
    expect(fixture.codex.adapter.spawn).toHaveBeenCalledOnce()
    expect(fixture.codex.adapter.spawn.mock.calls[0]?.[4]?.agent).toMatchObject({ harness: 'codex-sdk' })
    expect(run.runtimeHarness).toBe('codex-sdk')
    expect(mappingCreate).toHaveBeenCalledOnce()
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toMatchObject({ harness: 'codex-sdk' })
    expect(fixture.order).toEqual(['evidence:create', 'codex:spawn'])
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      type: 'custom',
      payload: {
        kind: 'runtime.harness.resolved',
        harness: {
          id: harness.id,
          name: 'runtime-codex',
          projectId: null,
          type: 'codex-sdk',
          spec: { type: 'codex-sdk', command: 'codex', controlMode: 'managed', supportedSandboxes: ['host', 'container'] },
        },
      },
    })
  })


  it('passes the resolved Codex Harness command through DUCTUM_CODEX_COMMAND unless the env override is already set', async () => {
    const fixture = createFixture()
    createHarness(fixture.context, 'runtime-codex', { type: 'codex-sdk', command: '/opt/codex-wrapper' })
    fixture.context.agentRepo.update(fixture.builder.id, {
      harness: 'claude-agent-sdk',
      resourceRefs: { harnessRef: 'runtime-codex' },
    })
    createTask(fixture)

    await fixture.dispatcher.cycle()

    expect(fixture.codex.adapter.spawn.mock.calls[0]?.[4]?.env?.DUCTUM_CODEX_COMMAND).toBe('/opt/codex-wrapper')

    const overrideFixture = createFixture({
      materializeAgentEnv: () => ({ env: { DUCTUM_CODEX_COMMAND: '/env/codex' }, droppedKeys: [] }),
    })
    createHarness(overrideFixture.context, 'runtime-codex', { type: 'codex-sdk', command: '/opt/codex-wrapper' })
    overrideFixture.context.agentRepo.update(overrideFixture.builder.id, {
      harness: 'claude-agent-sdk',
      resourceRefs: { harnessRef: 'runtime-codex' },
    })
    createTask(overrideFixture)

    await overrideFixture.dispatcher.cycle()

    expect(overrideFixture.codex.adapter.spawn.mock.calls[0]?.[4]?.env?.DUCTUM_CODEX_COMMAND).toBe('/env/codex')
  })

  it.each([
    ['missing harnessRef', (f: ReturnType<typeof createFixture>) => f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'missing-harness' } }), 'harnessRef not found: missing-harness'],
    ['wrong-kind harnessRef', (f: ReturnType<typeof createFixture>) => {
      f.context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'not-a-harness', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'not-a-harness' } })
    }, 'references Model, expected Harness'],
    ['cross-project harnessRef', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'other-harness', { type: 'codex-sdk' }, otherProject(f).id)
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'other-harness' } })
    }, 'outside the run project'],
    ['unsupported harness adapter', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'future-harness', { type: 'future-sdk' })
      f.context.agentRepo.update(f.builder.id, { harness: 'claude-agent-sdk', resourceRefs: { harnessRef: 'future-harness' } })
    }, 'resolved to unsupported harness: future-sdk'],
    ['non-object harness spec', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'null-harness', null)
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'null-harness' } })
    }, 'without an object spec'],
    ['blank harness type', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'blank-harness', { type: '   ' })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'blank-harness' } })
    }, 'without Harness adapter type spec.type'],
    ['non-string command', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'bad-command', { type: 'codex-sdk', command: 123 })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'bad-command' } })
    }, 'non-string spec.command'],
    ['blank command', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'blank-command', { type: 'codex-sdk', command: '   ' })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'blank-command' } })
    }, 'empty spec.command'],
    ['non-string controlMode', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'bad-control', { type: 'codex-sdk', controlMode: false })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'bad-control' } })
    }, 'non-string spec.controlMode'],
    ['string supportedSandboxes', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'bad-sandboxes', { type: 'codex-sdk', supportedSandboxes: 'host' })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { harnessRef: 'bad-sandboxes' } })
    }, 'invalid spec.supportedSandboxes'],
    ['malformed harnessRef', (f: ReturnType<typeof createFixture>) => {
      createHarness(f.context, 'bad-harness', { type: 'codex-sdk', supportedSandboxes: ['host', 7] })
      f.context.agentRepo.update(f.builder.id, { harness: 'claude-agent-sdk', resourceRefs: { harnessRef: 'bad-harness' } })
    }, 'invalid spec.supportedSandboxes'],
  ])('rejects %s before run/session creation without legacy fallback', async (_name, setup, expected) => {
    await expectPreRunFailure(setup, expected)
  })

  it('prefers project-scoped Harness resources over factory resources with the same name', async () => {
    const fixture = createFixture()
    createHarness(fixture.context, 'shared-harness', { type: 'claude-agent-sdk' })
    createHarness(fixture.context, 'shared-harness', { type: 'codex-sdk' }, fixture.project.id)
    fixture.context.agentRepo.update(fixture.builder.id, {
      harness: 'claude-agent-sdk',
      resourceRefs: { harnessRef: 'shared-harness' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors).toEqual([])
    expect(fixture.claude.adapter.spawn).not.toHaveBeenCalled()
    expect(fixture.codex.adapter.spawn).toHaveBeenCalledOnce()
    expect(fixture.context.runRepo.list(task.id)[0]?.runtimeHarness).toBe('codex-sdk')
  })

  it('surfaces audit evidence write failures and never creates a session mapping', async () => {
    const fixture = createFixture()
    createHarness(fixture.context, 'runtime-codex', { type: 'codex-sdk' })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { harnessRef: 'runtime-codex' } })
    vi.spyOn(fixture.context.evidenceRepo, 'create').mockImplementation(() => {
      throw new Error('evidence store down')
    })
    const mappingCreate = vi.spyOn(fixture.context.sessionRunMappingRepo, 'create')
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('evidence store down')
    expect(run.terminalState).toBe('stalled')
    expect(fixture.codex.adapter.spawn).not.toHaveBeenCalled()
    expect(mappingCreate).not.toHaveBeenCalled()
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toBeNull()
  })

  it('preserves legacy no-ref dispatch and skips Harness resource audit evidence', async () => {
    const fixture = createFixture()
    const mappingCreate = vi.spyOn(fixture.context.sessionRunMappingRepo, 'create')
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0] as Run

    expect(result.errors).toEqual([])
    expect(fixture.claude.adapter.spawn).toHaveBeenCalledOnce()
    expect(fixture.codex.adapter.spawn).not.toHaveBeenCalled()
    expect(run.runtimeHarness).toBe('claude-agent-sdk')
    expect(mappingCreate).toHaveBeenCalledOnce()
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toMatchObject({ harness: 'claude-agent-sdk' })
    expect(fixture.context.evidenceRepo.list(run.id)).toEqual([])
  })
})
