import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type RunWorkflowProfileSnapshot } from '../types.js'
import { loadRenderedWorkflowProfile } from '../workflow-renderer.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: Array<{ close(): void }> = []
const cleanupPaths: string[] = []
const templatePath = fileURLToPath(new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url))

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry.close()
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
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

function createTargetRepoProfile() {
  const repoPath = mkdtempSync(join(tmpdir(), 'ductum-target-repo-'))
  cleanupPaths.push(repoPath)
  mkdirSync(join(repoPath, '.edictum'))
  writeFileSync(join(repoPath, 'SPEC.md'), '# Spec\n')
  const profilePath = join(repoPath, '.edictum', 'workflow-profile.yaml')
  writeFileSync(profilePath, [
    'apiVersion: edictum/v1alpha1',
    'kind: WorkflowProfile',
    'metadata:',
    '  name: qratum-target',
    'context:',
    '  required_files: [SPEC.md]',
    'setup:',
    '  commands:',
    "    - 'go mod download'",
    'verify:',
    "  commands: ['go test ./...']",
    'push: {}',
    '',
  ].join('\n'))
  return { repoPath, profilePath }
}

describe('WorkflowProfile target runtime', () => {
  it('materializes the factory coding-guard preset from the target repo profile', async () => {
    const { repoPath, profilePath } = createTargetRepoProfile()
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const { project, builder, spec } = seedBase(context)
    const events = new DuctumEventEmitter()
    const adapter = createAdapter()
    const createWorktree = vi.fn(async () => repoPath)
    const validateWorkflowProfile = vi.fn((profile: RunWorkflowProfileSnapshot) => {
      const rendered = loadRenderedWorkflowProfile(templatePath, profile.path)
      return {
        renderedWorkflow: rendered.renderedWorkflow,
        setupCommands: rendered.profile.setup?.commands ?? [],
        verifyCommands: rendered.profile.verify.commands,
      }
    })
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: null,
      name: 'coding-guard',
      spec: { path: 'workflows/coding-guard-profile.yaml' },
    })
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'coding-guard' } })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'Target workflow profile',
      prompt: 'implement',
      repos: ['qratum'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: ['go test ./...'],
    })
    const dispatcher = new Dispatcher(
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
      new Map([[builder.harness, adapter.adapter]]),
      events,
      {
        createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
        resolveRepoPath: () => repoPath,
        resolveSetupCommands: (_projectName, profile) => profile?.setupCommands ?? [],
        validateWorkflowProfile,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: createWorktree } as never,
      { resolveVerifyCommands: (_projectName, profile) => profile?.verifyCommands, resolveReviewerAgent: () => null, onReadyToShip: vi.fn() },
      context.configResourceRepo,
      context.evidenceRepo,
    )

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(run.runtimeWorkflowProfile).toMatchObject({
      name: 'coding-guard',
      path: profilePath,
      renderedWorkflow: expect.stringContaining('Read SPEC.md before editing'),
      setupCommands: ['go mod download'],
      verifyCommands: ['go test ./...'],
    })
    expect(validateWorkflowProfile.mock.calls[0]?.[0]).toMatchObject({ path: profilePath })
    expect(createWorktree).toHaveBeenCalledWith(repoPath, task.name, run.id, project.name, ['go mod download'])
    expect(adapter.adapter.spawn).toHaveBeenCalledOnce()
  })

  it('uses a project-scoped seeded workflow profile without weakening the factory-wide preset', async () => {
    const { repoPath, profilePath } = createTargetRepoProfile()
    const context = createRepoContext()
    cleanup.push({ close: () => context.db.close() })
    const { project, builder, spec } = seedBase(context)
    const events = new DuctumEventEmitter()
    const adapter = createAdapter()
    const createWorktree = vi.fn(async () => repoPath)
    const validateWorkflowProfile = vi.fn((profile: RunWorkflowProfileSnapshot) => {
      const rendered = loadRenderedWorkflowProfile(templatePath, profile.path)
      return {
        renderedWorkflow: rendered.renderedWorkflow,
        setupCommands: rendered.profile.setup?.commands ?? [],
        verifyCommands: rendered.profile.verify.commands,
      }
    })
    context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'coding-guard',
      spec: { path: profilePath },
    })
    context.agentRepo.update(builder.id, { resourceRefs: { workflowProfileRef: 'coding-guard' } })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'Seeded workflow profile',
      prompt: 'implement',
      repos: ['qratum'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: ['go test ./...'],
    })
    const dispatcher = new Dispatcher(
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
      new Map([[builder.harness, adapter.adapter]]),
      events,
      {
        createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
        resolveRepoPath: () => repoPath,
        resolveSetupCommands: (_projectName, profile) => profile?.setupCommands ?? [],
        validateWorkflowProfile,
      },
      { enabled: true, cleanupOnFailure: false, isGitRepo: vi.fn(() => true), create: createWorktree } as never,
      { resolveVerifyCommands: (_projectName, profile) => profile?.verifyCommands, resolveReviewerAgent: () => null, onReadyToShip: vi.fn() },
      context.configResourceRepo,
      context.evidenceRepo,
    )

    const result = await dispatcher.cycle()
    const run = context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(run.runtimeWorkflowProfile).toMatchObject({
      name: 'coding-guard',
      path: profilePath,
      verifyCommands: ['go test ./...'],
    })
    expect(validateWorkflowProfile.mock.calls[0]?.[0]).toMatchObject({ path: profilePath })
    expect(adapter.adapter.spawn).toHaveBeenCalledOnce()
  })
})
