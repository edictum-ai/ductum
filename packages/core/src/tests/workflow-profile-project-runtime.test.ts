import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type RunWorkflowProfileSnapshot, type Task } from '../types.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase, type RepoContext } from './helpers.js'

const cleanup: Array<{ close(): void }> = []
const tempdirs: string[] = []

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry.close()
  for (const dir of tempdirs.splice(0)) {
    void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
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

function createFixture(options: { resolveRepoPath?: (name: string) => string | undefined } = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  // Force the live-legacy shape: only `{ mergeMode, workflowPath }`, no
  // workflowProfileRef/workflowProfile on the project, and no agent refs.
  context.projectRepo.update(project.id, {
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
  context.agentRepo.update(builder.id, { resourceRefs: undefined })
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
  const adapter = createAdapter()
  const resolveSetupCommands = vi.fn((_projectName: string, profile?: RunWorkflowProfileSnapshot | null) =>
    profile == null ? ['legacy-setup'] : [`setup:${profile.name}`])
  const resolveVerifyCommands = vi.fn((_projectName: string, profile?: RunWorkflowProfileSnapshot | null) =>
    profile == null ? ['legacy-verify'] : [`verify:${profile.name}`])
  const validateWorkflowProfile = vi.fn((profile: RunWorkflowProfileSnapshot) => ({
    renderedWorkflow: `rendered:${profile.name}`,
    setupCommands: [`setup:${profile.name}`],
    verifyCommands: [`verify:${profile.name}`],
  }))
  const createWorktree = vi.fn(async (_repo, _task, _run, _project, setup) => `/tmp/ductum-${setup?.length ?? 0}`)
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
      resolveRepoPath: options.resolveRepoPath ?? (() => '/repo/ductum'),
      resolveSetupCommands,
      validateWorkflowProfile,
    },
    worktreeManager,
    {
      resolveVerifyCommands,
      resolveReviewerAgent: () => null,
      onReadyToShip: vi.fn(),
      rebaseBase: '',
    },
    context.configResourceRepo,
    context.evidenceRepo,
  )
  return { context, project, builder, spec, adapter, dispatcher, resolveSetupCommands, resolveVerifyCommands, validateWorkflowProfile, createWorktree }
}

function createTask(fixture: ReturnType<typeof createFixture>): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Repo profile runtime',
    prompt: 'implement',
    repos: ['packages/core'],
    assignedAgentId: fixture.builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

async function createRepoWithWorkflowProfile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-repo-profile-'))
  tempdirs.push(dir)
  await mkdir(join(dir, '.edictum'), { recursive: true })
  await writeFile(join(dir, '.edictum', 'workflow-profile.yaml'), 'profile: repo\n')
  return dir
}

async function createRepoWithoutWorkflowProfile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-no-profile-'))
  tempdirs.push(dir)
  return dir
}

describe('runtime workflow hydration — workflowPath-only legacy project fallback (#243)', () => {
  it('materializes repo .edictum/workflow-profile.yaml when project has only {mergeMode, workflowPath}', async () => {
    const repoDir = await createRepoWithWorkflowProfile()
    const fixture = createFixture({ resolveRepoPath: () => repoDir })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(fixture.adapter.adapter.spawn).toHaveBeenCalledOnce()
    expect(run.runtimeWorkflowProfile).toMatchObject({
      name: 'repo-coding-guard',
      projectId: null,
      path: join(repoDir, '.edictum', 'workflow-profile.yaml'),
      renderedWorkflow: 'rendered:repo-coding-guard',
      setupCommands: ['setup:repo-coding-guard'],
      verifyCommands: ['verify:repo-coding-guard'],
    })
    expect(fixture.resolveSetupCommands).toHaveBeenCalledWith(fixture.project.name, run.runtimeWorkflowProfile)
    expect(fixture.validateWorkflowProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'repo-coding-guard' }))
  })

  it('stays null when the working directory has no .edictum/workflow-profile.yaml', async () => {
    const repoDir = await createRepoWithoutWorkflowProfile()
    const fixture = createFixture({ resolveRepoPath: () => repoDir })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(run.runtimeWorkflowProfile).toBeNull()
    expect(fixture.resolveSetupCommands).toHaveBeenCalledWith(fixture.project.name, undefined)
    expect(fixture.createWorktree).toHaveBeenCalledWith(repoDir, task.name, run.id, fixture.project.name, ['legacy-setup'])
  })
})
