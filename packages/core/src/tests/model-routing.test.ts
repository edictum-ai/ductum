import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Run, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
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
  return {
    sessions,
    adapter: {
      spawn,
      kill: vi.fn(async (sessionId: string) => {
        sessions.find((s) => s.sessionId === sessionId)?.done.resolve({ exitReason: 'killed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
      }),
      isAlive: vi.fn(async () => true),
    } satisfies HarnessAdapter,
  }
}

function createRoutingFixture() {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, reviewer, spec } = seedBase(context)

  // Add a cheap agent (glm) for routing tests
  const cheapAgent = context.agentRepo.create({
    id: createId<'AgentId'>(),
    name: 'glm',
    model: 'zai-coding-plan/glm-5v-turbo',
    harness: 'vercel-ai',
    capabilities: ['docs'],
    costTier: 10,
    spawnConfig: {},
  })
  // Assign cheap agent as builder to the project
  context.projectAgentRepo.assign({ projectId: project.id, agentId: cheapAgent.id, role: 'builder' })

  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)

  const claudeHarness = createAdapter('claude')
  const reviewerHarness = createAdapter('vercel-ai')
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
      ['claude-agent-sdk', claudeHarness.adapter],
      ['vercel-ai', reviewerHarness.adapter],
    ]),
    eventEmitter,
    {
      pollIntervalMs: 60_000,
      maxConcurrentRuns: 5,
      createMcpServer: async () => ({ close: vi.fn() } satisfies DispatcherMcpServer),
    },
  )

  return { context, project, builder, reviewer, cheapAgent, spec, dispatcher, claudeHarness, reviewerHarness }
}

function makeTask(
  fixture: ReturnType<typeof createRoutingFixture>,
  fields: Partial<Pick<Task, 'complexity' | 'requiredRole' | 'assignedAgentId'>> = {},
): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: `Task ${Math.random()}`,
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fields.assignedAgentId ?? null,
    requiredRole: fields.requiredRole,
    complexity: fields.complexity,
    status: 'ready',
    verification: [],
  })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Model Routing', () => {
  it('routes simple tasks to cheapest agent (lowest costTier)', async () => {
    const fixture = createRoutingFixture()
    // builder=mimi(costTier=90), reviewer=codex(costTier=80), cheapAgent=glm(costTier=10)
    // All three are assigned as builder
    const task = makeTask(fixture, { complexity: 'simple' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toHaveLength(1)
    // Should dispatch to glm (costTier=10) — cheapest builder
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run).toBeDefined()
    expect(run!.agentId).toBe(fixture.cheapAgent.id)
  })

  it('routes complex tasks to most capable agent (highest costTier)', async () => {
    const fixture = createRoutingFixture()
    const task = makeTask(fixture, { complexity: 'complex' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toHaveLength(1)
    // Should dispatch to mimi (costTier=90) — most capable builder
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run).toBeDefined()
    expect(run!.agentId).toBe(fixture.builder.id)
  })

  it('routes standard complexity tasks using default order', async () => {
    const fixture = createRoutingFixture()
    const task = makeTask(fixture, { complexity: 'standard' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toHaveLength(1)
    // Standard = no sorting, first available agent from getByRole
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run).toBeDefined()
  })

  it('routes null complexity tasks using default order', async () => {
    const fixture = createRoutingFixture()
    const task = makeTask(fixture, { complexity: null })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toHaveLength(1)
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run).toBeDefined()
  })

  it('falls back to next agent when preferred is busy', async () => {
    const fixture = createRoutingFixture()
    // First task: simple -> dispatches to glm (cheapest builder, costTier=10)
    makeTask(fixture, { complexity: 'simple' })
    await fixture.dispatcher.cycle()
    await flush()

    // Second simple task: glm is busy, should fall back to next cheapest builder
    const task2 = makeTask(fixture, { complexity: 'simple' })
    const result2 = await fixture.dispatcher.cycle()

    expect(result2.tasksDispatched).toHaveLength(1)
    const run2 = fixture.context.runRepo.list(task2.id)[0]
    expect(run2).toBeDefined()
    // Should be mimi (costTier=90, only other builder) since glm is busy
    expect(run2!.agentId).toBe(fixture.builder.id)
  })

  it('quietly leaves assigned-agent tasks ready while that agent is busy', async () => {
    const fixture = createRoutingFixture()
    const task1 = makeTask(fixture, { assignedAgentId: fixture.cheapAgent.id })
    const task2 = makeTask(fixture, { assignedAgentId: fixture.cheapAgent.id })

    const result1 = await fixture.dispatcher.cycle()
    await flush()
    const result2 = await fixture.dispatcher.cycle()

    expect(result1.tasksDispatched).toEqual([task1.id])
    expect(result2.tasksDispatched).toEqual([])
    expect(result2.errors).toEqual([])
    expect(fixture.context.taskRepo.get(task2.id)?.status).toBe('ready')
  })

  it('multi-role agent is matched for any assigned role', async () => {
    const fixture = createRoutingFixture()
    // Assign mimi as both builder and reviewer
    fixture.context.projectAgentRepo.assign({
      projectId: fixture.project.id,
      agentId: fixture.builder.id,
      role: 'reviewer',
    })

    // Create a task requiring reviewer role
    const task = makeTask(fixture, { requiredRole: 'reviewer' })
    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toHaveLength(1)
    const run = fixture.context.runRepo.list(task.id)[0]
    expect(run).toBeDefined()
    // Either mimi or codex should be matched as reviewer
    const validReviewers = [fixture.builder.id, fixture.reviewer.id]
    expect(validReviewers).toContain(run!.agentId)
  })

  it('complexity field persists through task creation and retrieval', () => {
    const fixture = createRoutingFixture()
    const task = makeTask(fixture, { complexity: 'complex' })
    const retrieved = fixture.context.taskRepo.get(task.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.complexity).toBe('complex')
  })

  it('task with null complexity has null in database', () => {
    const fixture = createRoutingFixture()
    const task = makeTask(fixture)
    const retrieved = fixture.context.taskRepo.get(task.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.complexity).toBeNull()
  })

  it('agent costTier persists through creation and retrieval', () => {
    const fixture = createRoutingFixture()
    const agent = fixture.context.agentRepo.get(fixture.cheapAgent.id)
    expect(agent).not.toBeNull()
    expect(agent!.costTier).toBe(10)

    const builder = fixture.context.agentRepo.get(fixture.builder.id)
    expect(builder).not.toBeNull()
    expect(builder!.costTier).toBe(90)
  })

  it('project_agents supports multiple roles for same agent', () => {
    const fixture = createRoutingFixture()
    // Assign builder (mimi) as docs too
    fixture.context.projectAgentRepo.assign({
      projectId: fixture.project.id,
      agentId: fixture.builder.id,
      role: 'docs',
    })

    const allAssignments = fixture.context.projectAgentRepo.list(fixture.project.id)
    const mimiAssignments = allAssignments.filter((a) => a.agentId === fixture.builder.id)
    const mimiRoles = mimiAssignments.map((a) => a.role).sort()

    // mimi should have builder + docs roles
    expect(mimiRoles).toContain('builder')
    expect(mimiRoles).toContain('docs')

    // getByRole should return mimi for docs
    const docsAgents = fixture.context.projectAgentRepo.getByRole(fixture.project.id, 'docs')
    expect(docsAgents.some((a) => a.agentId === fixture.builder.id)).toBe(true)
  })
})
