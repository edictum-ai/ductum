import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Agent, type ProjectId, type RunWorkflowProfileSnapshot, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createAdapter() {
  const sessions: Array<{ done: ReturnType<typeof deferred<HarnessSessionResult>> }> = []
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    const done = deferred<HarnessSessionResult>()
    sessions.push({ done })
    return { sessionId: `session-${run.id}`, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { sessions, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createWorkflowProfile(context: RepoContext, name: string, spec: unknown, projectId: ProjectId | null = null) {
  return context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'WorkflowProfile', projectId, name, spec: spec as never })
}

function createTask(context: RepoContext, specId: Task['specId'], agentId: Agent['id'], repos: string[] = ['packages/core']): Task {
  return context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId,
    name: 'Workspace preflight dispatcher',
    prompt: 'implement',
    repos,
    assignedAgentId: agentId,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

describe('workspace preflight dispatcher integration', () => {
  it('checks env refs against the materialized agent env used for spawn', async () => {
    vi.stubEnv('API_TOKEN', '')
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const repoDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-env-repo-'))
    cleanup.push({ close: () => rmSync(repoDir, { recursive: true, force: true }) })
    const { project, builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-env',
      setupCommands: ['setup:preflight-env'],
      verifyCommands: ['verify:preflight-env'],
      preflight: { env: ['API_TOKEN'] },
    }))
    const materializeAgentEnv = vi.fn((_agent: Agent, _context: { runId: import('../types.js').RunId; agentId: import('../types.js').AgentId }) => ({
      env: { API_TOKEN: 'resolved-secret' },
      droppedKeys: [],
    }))
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
        resolveRepoPath: () => repoDir,
        resolveSetupCommands: (_projectName, profile) => profile == null ? ['legacy-setup'] : profile.setupCommands,
        validateWorkflowProfile,
        materializeAgentEnv,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: vi.fn(async () => repoDir) } as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    createWorkflowProfile(context, 'preflight-env', { path: '/tmp/profile.yaml' }, project.id)
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'preflight-env' } })
    const task = createTask(context, spec.id, builder.id)

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(materializeAgentEnv).toHaveBeenCalledWith(expect.anything(), { runId: run.id, agentId: builder.id })
    expect(adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(adapter.adapter.spawn.mock.calls[0]?.[4]?.env?.API_TOKEN).toBe('resolved-secret')
    expect(context.evidenceRepo.list(run.id).some((item) => item.payload.kind === 'preflight.hydration')).toBe(true)
  })

  it('checks env refs against the final Codex command env used for spawn', async () => {
    vi.stubEnv('DUCTUM_CODEX_COMMAND', '')
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const repoDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-codex-env-repo-'))
    cleanup.push({ close: () => rmSync(repoDir, { recursive: true, force: true }) })
    const { project, builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-codex-env',
      setupCommands: ['setup:preflight-codex-env'],
      verifyCommands: ['verify:preflight-codex-env'],
      preflight: { env: ['DUCTUM_CODEX_COMMAND'] },
    }))
    context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: project.id, name: 'codex-command', spec: { type: 'codex-sdk', command: 'codex --profile work' } as never })
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
      new Map([['codex-sdk', adapter.adapter]]),
      eventEmitter,
      {
        maxConcurrentRuns: 3,
        buildSystemPrompt: (task) => `prompt:${task.id}`,
        createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
        resolveRepoPath: () => repoDir,
        resolveSetupCommands: (_projectName, profile) => profile == null ? ['legacy-setup'] : profile.setupCommands,
        validateWorkflowProfile,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: vi.fn(async () => repoDir) } as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    createWorkflowProfile(context, 'preflight-codex-env', { path: '/tmp/profile.yaml' }, project.id)
    context.agentRepo.update(builder.id, { resourceRefs: { harnessRef: 'codex-command', workflowProfileRef: 'preflight-codex-env' } })
    const task = createTask(context, spec.id, builder.id)

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(adapter.adapter.spawn.mock.calls[0]?.[4]?.env?.DUCTUM_CODEX_COMMAND).toBe('codex --profile work')
    expect(adapter.adapter.spawn.mock.calls[0]?.[4]?.env?.PATH).toBe(process.env.PATH)
    expect(context.evidenceRepo.list(run.id).some((item) => item.payload.kind === 'preflight.hydration')).toBe(true)
  })

  it('checks dependency install state in the spawned worktree', async () => {
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-base-'))
    const spawnedDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-spawned-'))
    cleanup.push({ close: () => rmSync(baseDir, { recursive: true, force: true }) })
    cleanup.push({ close: () => rmSync(spawnedDir, { recursive: true, force: true }) })
    mkdirSync(join(baseDir, 'node_modules'))
    const { project, builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-deps',
      setupCommands: ['setup:preflight-deps'],
      verifyCommands: ['verify:preflight-deps'],
      preflight: { dependencies: { installDir: 'node_modules' } },
    }))
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
        resolveRepoPath: () => baseDir,
        resolveSetupCommands: (_projectName, profile) => profile == null ? ['legacy-setup'] : profile.setupCommands,
        validateWorkflowProfile,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: vi.fn(async () => spawnedDir) } as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    createWorkflowProfile(context, 'preflight-deps', { path: '/tmp/profile.yaml' }, project.id)
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'preflight-deps' } })
    const task = createTask(context, spec.id, builder.id)

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('node_modules')
    expect(adapter.adapter.spawn).not.toHaveBeenCalled()
    expect(context.taskRepo.get(task.id)?.status).toBe('blocked')
    expect(run.terminalState).toBe('stalled')
    expect(run.failReason).toContain('node_modules')
  })

  it('preflights the agent spawnConfig workingDir fallback used for spawn', async () => {
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const agentDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-agent-cwd-'))
    cleanup.push({ close: () => rmSync(agentDir, { recursive: true, force: true }) })
    const { project, builder, spec } = seedBase(context)
    context.agentRepo.update(builder.id, { spawnConfig: { workingDir: agentDir } })
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-agent-cwd',
      setupCommands: ['setup:preflight-agent-cwd'],
      verifyCommands: ['verify:preflight-agent-cwd'],
      preflight: {},
    }))
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
        resolveRepoPath: () => undefined,
        resolveSetupCommands: (_projectName, profile) => profile == null ? ['legacy-setup'] : profile.setupCommands,
        validateWorkflowProfile,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => false), create: vi.fn() } as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    createWorkflowProfile(context, 'preflight-agent-cwd', { path: '/tmp/profile.yaml' }, project.id)
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'preflight-agent-cwd' } })
    const task = createTask(context, spec.id, builder.id, [])

    const result = await dispatcher.cycle()

    expect(result.errors).toEqual([])
    expect(adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(adapter.adapter.spawn.mock.calls[0]?.[4]?.workingDir).toBe(agentDir)
  })
})
