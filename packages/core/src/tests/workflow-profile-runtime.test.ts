import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type ProjectId, type RunWorkflowProfileSnapshot, type Task } from '../types.js'
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

function createAdapter(order: string[]) {
  const sessions: Array<{ done: ReturnType<typeof deferred<HarnessSessionResult>> }> = []
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    order.push('spawn')
    const done = deferred<HarnessSessionResult>()
    sessions.push({ done })
    return { sessionId: `session-${run.id}`, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { sessions, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createFixture(options: { omitConfigResourceRepo?: boolean; omitValidator?: boolean } = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
  const order: string[] = []
  const adapter = createAdapter(order)
  const resolveSetupCommands = vi.fn((_projectName: string, profile?: RunWorkflowProfileSnapshot) => profile == null ? ['legacy-setup'] : [`setup:${profile.name}`])
  const resolveVerifyCommands = vi.fn((_projectName: string, profile?: RunWorkflowProfileSnapshot) => profile == null ? ['legacy-verify'] : [`verify:${profile.name}`])
  const validateWorkflowProfile = vi.fn((profile: RunWorkflowProfileSnapshot) => {
    order.push(`validate:${profile.name}`)
    return {
      renderedWorkflow: `rendered:${profile.name}`,
      setupCommands: [`setup:${profile.name}`],
      verifyCommands: [`verify:${profile.name}`],
      push: { protectedBranches: ['main'], allowedGitCommands: ['git status', 'git push'], protectedBranchMode: 'merge_gate_only' as const },
    }
  })
  const createWorktree = vi.fn(async (_repo, _task, _run, _project, setup) => {
    order.push(`worktree:${setup?.join('|') ?? ''}`)
    return `/tmp/ductum-${order.length}`
  })
  const worktreeManager = {
    enabled: true,
    cleanupOnFailure: false,
    isGitRepo: vi.fn(() => true),
    create: createWorktree,
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
    { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager,
    context.sessionRunMappingRepo,
    new Map([['claude-agent-sdk', adapter.adapter]]),
    eventEmitter,
    {
      maxConcurrentRuns: 3,
      buildSystemPrompt: (task) => `prompt:${task.id}`,
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
      resolveRepoPath: () => '/repo/ductum',
      resolveSetupCommands,
      ...(options.omitValidator ? {} : { validateWorkflowProfile }),
    },
    worktreeManager,
    {
      resolveVerifyCommands,
      resolveReviewerAgent: () => null,
      onReadyToShip: vi.fn(),
      rebaseBase: '',
    },
    options.omitConfigResourceRepo ? undefined : context.configResourceRepo,
    context.evidenceRepo,
  )
  return { context, project, builder, spec, adapter, dispatcher, order, resolveSetupCommands, resolveVerifyCommands, validateWorkflowProfile, createWorktree }
}

function createTask(fixture: ReturnType<typeof createFixture>): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Workflow profile runtime',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

function createWorkflowProfile(context: RepoContext, name: string, spec: unknown, projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'WorkflowProfile', projectId, name, spec: spec as never })
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

async function expectPreSessionFailure(
  setup: (fixture: ReturnType<typeof createFixture>) => void,
  expected: string,
) {
  const fixture = createFixture()
  fixture.context.projectRepo.update(fixture.project.id, {
    config: { ...fixture.project.config, workflowProfile: '/tmp/legacy-project-profile.yaml' },
  })
  setup(fixture)
  const task = createTask(fixture)

  const result = await fixture.dispatcher.cycle()

  expect(result.tasksDispatched).toEqual([])
  expect(result.errors[0]?.error).toContain(expected)
  expect(fixture.context.runRepo.list(task.id)).toEqual([])
  expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  expect(fixture.adapter.adapter.spawn).not.toHaveBeenCalled()
  expect(fixture.createWorktree).not.toHaveBeenCalled()
}

describe('WorkflowProfile resource runtime', () => {
  it('snapshots the resolved profile, records evidence, and uses it for setup and verify selection', async () => {
    const fixture = createFixture()
    const createEvidence = fixture.context.evidenceRepo.create.bind(fixture.context.evidenceRepo)
    vi.spyOn(fixture.context.evidenceRepo, 'create').mockImplementation((evidence) => {
      fixture.order.push('evidence')
      return createEvidence(evidence)
    })
    const profile = createWorkflowProfile(fixture.context, 'runtime-workflow', {
      path: ' /tmp/ductum-workflow-profile.yaml ',
      description: ' Resource profile ',
    }, fixture.project.id)
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { workflowProfileRef: 'runtime-workflow' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(fixture.adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(run.runtimeWorkflowProfile).toEqual({
      id: profile.id,
      name: 'runtime-workflow',
      projectId: fixture.project.id,
      path: '/tmp/ductum-workflow-profile.yaml',
      description: 'Resource profile',
      push: {
        protectedBranches: ['main'],
        allowedGitCommands: ['git status', 'git push'],
        protectedBranchMode: 'merge_gate_only' as const,
      },
      renderedWorkflow: 'rendered:runtime-workflow',
      setupCommands: ['setup:runtime-workflow'],
      verifyCommands: ['verify:runtime-workflow'],
    })
    expect(fixture.adapter.adapter.spawn.mock.calls[0]?.[0].runtimeWorkflowProfile).toEqual(run.runtimeWorkflowProfile)
    expect(fixture.validateWorkflowProfile.mock.calls[0]?.[0]).toMatchObject({
      id: profile.id,
      name: 'runtime-workflow',
      path: '/tmp/ductum-workflow-profile.yaml',
    })
    expect(fixture.resolveSetupCommands).toHaveBeenCalledWith(fixture.project.name, run.runtimeWorkflowProfile)
    expect(fixture.createWorktree).toHaveBeenCalledWith('/repo/ductum', task.name, run.id, fixture.project.name, ['setup:runtime-workflow'])
    expect(fixture.order).toEqual(['validate:runtime-workflow', 'evidence', 'worktree:setup:runtime-workflow', 'spawn'])
    expect(fixture.context.evidenceRepo.list(run.id)).toMatchObject([
      { payload: { kind: 'runtime.workflow_profile.resolved', workflowProfile: run.runtimeWorkflowProfile } },
    ])
    fixture.adapter.sessions[0]!.done.resolve({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await vi.waitFor(() => {
      expect(fixture.resolveVerifyCommands).toHaveBeenCalledWith(fixture.project.name, run.runtimeWorkflowProfile)
    })
  })

  it.each([
    ['missing workflowProfileRef', (f: ReturnType<typeof createFixture>) => f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'missing-workflow' } }), 'workflowProfileRef not found: missing-workflow'],
    ['wrong-kind workflowProfileRef', (f: ReturnType<typeof createFixture>) => {
      f.context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'not-workflow', spec: { provider: 'openai', modelId: 'gpt-5.4' } })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'not-workflow' } })
    }, 'references Model, expected WorkflowProfile'],
    ['cross-project workflowProfileRef', (f: ReturnType<typeof createFixture>) => {
      createWorkflowProfile(f.context, 'other-workflow', { path: '/tmp/other-profile.yaml' }, otherProject(f).id)
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'other-workflow' } })
    }, 'outside the run project'],
    ['non-object workflow spec', (f: ReturnType<typeof createFixture>) => {
      createWorkflowProfile(f.context, 'bad-workflow', null)
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'bad-workflow' } })
    }, 'without an object spec'],
    ['blank workflow path', (f: ReturnType<typeof createFixture>) => {
      createWorkflowProfile(f.context, 'blank-workflow', { path: '  ' })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'blank-workflow' } })
    }, 'without spec.path'],
    ['bad description', (f: ReturnType<typeof createFixture>) => {
      createWorkflowProfile(f.context, 'bad-description', { path: '/tmp/profile.yaml', description: 7 })
      f.context.agentRepo.update(f.builder.id, { resourceRefs: { workflowProfileRef: 'bad-description' } })
    }, 'non-string spec.description'],
  ])('rejects %s before run/session creation without legacy fallback', async (_name, setup, expected) => {
    await expectPreSessionFailure(setup, expected)
  })

  it('fails render validation before creating a run or spawning a session', async () => {
    const fixture = createFixture()
    createWorkflowProfile(fixture.context, 'unrenderable-workflow', { path: '/tmp/missing-profile.yaml' })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { workflowProfileRef: 'unrenderable-workflow' } })
    fixture.validateWorkflowProfile.mockImplementation(() => { throw new Error('render failed') })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('render failed')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.adapter.adapter.spawn).not.toHaveBeenCalled()
  })

  it('rejects workflowProfileRef when the dispatcher cannot validate profiles', async () => {
    const fixture = createFixture({ omitValidator: true })
    createWorkflowProfile(fixture.context, 'unvalidated-workflow', { path: '/tmp/profile.yaml' })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { workflowProfileRef: 'unvalidated-workflow' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('has no workflow profile validator')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  })

  it('rejects workflowProfileRef when validation returns no materialized runtime data', async () => {
    const fixture = createFixture()
    createWorkflowProfile(fixture.context, 'empty-runtime-workflow', { path: '/tmp/profile.yaml' })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { workflowProfileRef: 'empty-runtime-workflow' } })
    fixture.validateWorkflowProfile.mockImplementation(() => undefined as never)
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('did not return materialized runtime data')
    expect(result.errors[0]?.error).not.toContain('could not render WorkflowProfile')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  })

  it('rejects workflowProfileRef when the dispatcher has no config resource repo', async () => {
    const fixture = createFixture({ omitConfigResourceRepo: true })
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { workflowProfileRef: 'missing-repo' } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('has workflowProfileRef but dispatcher has no config resource repo')
    expect(fixture.context.runRepo.list(task.id)).toEqual([])
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
  })

  it('preserves legacy no-ref dispatch and legacy setup selection', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(run.runtimeWorkflowProfile).toBeNull()
    expect(fixture.adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(fixture.resolveSetupCommands).toHaveBeenCalledWith(fixture.project.name, undefined)
    expect(fixture.createWorktree).toHaveBeenCalledWith('/repo/ductum', task.name, run.id, fixture.project.name, ['legacy-setup'])
    expect(fixture.context.evidenceRepo.list(run.id).filter((item) => item.payload.kind === 'runtime.workflow_profile.resolved')).toEqual([])
  })
})
