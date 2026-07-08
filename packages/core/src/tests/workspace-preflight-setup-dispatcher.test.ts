import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Agent, type RunWorkflowProfileSnapshot, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: Array<() => void> = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const entry of cleanup.splice(0)) entry()
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

function createTask(context: ReturnType<typeof createRepoContext>, specId: Task['specId'], agentId: Agent['id']): Task {
  return context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId,
    name: 'Workspace setup preflight',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: agentId,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

describe('workspace setup preflight dispatch order', () => {
  it('blocks missing setup tools before worktree setup commands run', async () => {
    const context = createRepoContext()
    cleanup.push(() => context.db.close())
    const repoDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-setup-repo-'))
    cleanup.push(() => rmSync(repoDir, { recursive: true, force: true }))
    const { project, builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const worktreeManager = { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: vi.fn(async () => repoDir) }
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-setup',
      setupCommands: ['definitely-missing-package-manager install'],
      verifyCommands: ['verify:preflight-setup'],
      preflight: { packageManager: 'definitely-missing-package-manager' },
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
        resolveSetupCommands: (_projectName, profile) => profile == null ? undefined : profile.setupCommands,
        validateWorkflowProfile,
      },
      worktreeManager as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'WorkflowProfile', projectId: project.id, name: 'preflight-setup', spec: { path: '/tmp/profile.yaml' } as never })
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'preflight-setup' } })
    const task = createTask(context, spec.id, builder.id)

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('definitely-missing-package-manager')
    expect(worktreeManager.create).not.toHaveBeenCalled()
    expect(adapter.spawn).not.toHaveBeenCalled()
    expect(context.taskRepo.get(task.id)?.status).toBe('blocked')
    expect(run.terminalState).toBe('stalled')
  })

  it('passes materialized env into setup commands and setup preflight', async () => {
    vi.stubEnv('AGENT_ONLY_SETUP_ENV', '')
    const context = createRepoContext()
    cleanup.push(() => context.db.close())
    const repoDir = mkdtempSync(join(tmpdir(), 'ductum-preflight-setup-env-repo-'))
    cleanup.push(() => rmSync(repoDir, { recursive: true, force: true }))
    const { project, builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
    const adapter = createAdapter()
    const worktreeManager = { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: vi.fn(async () => repoDir) }
    const validateWorkflowProfile = vi.fn((_profile: RunWorkflowProfileSnapshot) => ({
      renderedWorkflow: 'rendered:preflight-setup-env',
      setupCommands: ['echo "$AGENT_ONLY_SETUP_ENV"'],
      verifyCommands: ['verify:preflight-setup-env'],
      preflight: { env: ['AGENT_ONLY_SETUP_ENV'] },
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
        resolveSetupCommands: (_projectName, profile) => profile == null ? undefined : profile.setupCommands,
        validateWorkflowProfile,
        materializeAgentEnv: () => ({ env: { AGENT_ONLY_SETUP_ENV: 'agent-only' }, droppedKeys: [] }),
      },
      worktreeManager as never,
      { resolveVerifyCommands: () => ['verify'], resolveReviewerAgent: () => null, onReadyToShip: vi.fn(), rebaseBase: '' },
      context.configResourceRepo,
      context.evidenceRepo,
    )
    context.configResourceRepo.create({ id: createId<'ConfigResourceId'>(), kind: 'WorkflowProfile', projectId: project.id, name: 'preflight-setup-env', spec: { path: '/tmp/profile.yaml' } as never })
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'preflight-setup-env' } })
    const task = createTask(context, spec.id, builder.id)

    const result = await dispatcher.cycle()

    expect(result.errors).toEqual([])
    expect(result.tasksDispatched).toEqual([task.id])
    expect(worktreeManager.create).toHaveBeenCalledWith(
      repoDir,
      task.name,
      expect.any(String),
      project.name,
      ['echo "$AGENT_ONLY_SETUP_ENV"'],
      expect.objectContaining({ AGENT_ONLY_SETUP_ENV: 'agent-only' }),
    )
    expect(adapter.spawn).toHaveBeenCalledWith(
      expect.anything(),
      task,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ env: expect.objectContaining({ AGENT_ONLY_SETUP_ENV: 'agent-only' }) }),
    )
    expect(context.taskRepo.get(task.id)?.status).toBe('active')
  })
})
