import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter, type HarnessSessionResult } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { createId, type Task } from '../types.js'
import type { WatcherManager } from '../watcher-manager.js'
import type { WorktreeManager } from '../worktree.js'
import { createRepoContext, seedBase } from './helpers.js'

const cleanup: Array<{ close(): void }> = []

afterEach(() => {
  for (const entry of cleanup.splice(0)) entry.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function tmpRoot() {
  const path = mkdtempSync(join(tmpdir(), 'ductum-agent-prompt-'))
  cleanup.push({ close: () => rmSync(path, { recursive: true, force: true }) })
  return path
}

function createAdapter(order: string[]) {
  const spawn = vi.fn<HarnessAdapter['spawn']>(async (run) => {
    order.push('spawn')
    const done = deferred<HarnessSessionResult>()
    return { sessionId: `session-${run.id}`, runId: run.id, waitForCompletion: () => done.promise }
  })
  return { spawn, adapter: { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) } satisfies HarnessAdapter }
}

function createFixture(options: {
  repoPath?: string
  worktreeManager?: WorktreeManager
} = {}) {
  const context = createRepoContext()
  cleanup.push({ close: () => context.db.close() })
  const { project, builder, spec } = seedBase(context)
  const eventEmitter = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter)
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
      maxConcurrentRuns: 3,
      buildSystemPrompt: () => 'DISPATCHER PROMPT: call ductum_workflow before work.',
      createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
      ...(options.repoPath == null ? {} : { resolveRepoPath: () => options.repoPath }),
    },
    options.worktreeManager,
    undefined,
    context.configResourceRepo,
    context.evidenceRepo,
  )
  return { context, project, builder, spec, order, harness, dispatcher }
}

function createTask(fixture: ReturnType<typeof createFixture>): Task {
  return fixture.context.taskRepo.create({
    id: createId<'TaskId'>(),
    specId: fixture.spec.id,
    name: 'Agent prompt runtime',
    prompt: 'implement',
    repos: ['ductum'],
    assignedAgentId: fixture.builder.id,
    status: 'ready',
    verification: ['pnpm test'],
  })
}

function writePrompt(root: string, rel: string, content: string) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('agent system prompt runtime', () => {
  it('composes systemPromptRef content with dispatcher guardrails and records metadata before spawn', async () => {
    const repoPath = tmpRoot()
    writePrompt(repoPath, 'prompts/agents/builder.md', 'AGENT PERSONA: be precise.\n')
    const fixture = createFixture({ repoPath })
    const createEvidence = fixture.context.evidenceRepo.create.bind(fixture.context.evidenceRepo)
    vi.spyOn(fixture.context.evidenceRepo, 'create').mockImplementation((evidence) => {
      fixture.order.push('evidence')
      return createEvidence(evidence)
    })
    const mappingCreate = vi.spyOn(fixture.context.sessionRunMappingRepo, 'create')
    fixture.context.agentRepo.update(fixture.builder.id, {
      resourceRefs: { systemPromptRef: 'prompts/agents/builder.md', toolsRef: 'metadata-only', policyRef: 'metadata-only' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    const prompt = fixture.harness.spawn.mock.calls[0]?.[2] ?? ''
    const evidence = fixture.context.evidenceRepo.list(run.id)
    const promptEvidence = evidence[0]?.payload as { systemPrompt?: { sha256?: unknown } } | undefined

    expect(result.errors).toEqual([])
    expect(fixture.order).toEqual(['evidence', 'spawn'])
    expect(prompt).toContain('AGENT PERSONA: be precise.')
    expect(prompt).toContain('DISPATCHER PROMPT: call ductum_workflow before work.')
    expect(mappingCreate).toHaveBeenCalledOnce()
    expect(evidence[0]?.payload).toMatchObject({
      kind: 'runtime.agent_system_prompt.resolved',
      systemPrompt: { ref: 'prompts/agents/builder.md', bytes: 27 },
    })
    expect(String(promptEvidence?.systemPrompt?.sha256)).toHaveLength(64)
    expect(JSON.stringify(evidence[0]?.payload)).not.toContain('AGENT PERSONA')
  })

  it('resolves systemPromptRef from the selected sandbox worktree', async () => {
    const repoPath = tmpRoot()
    const worktreePath = tmpRoot()
    writePrompt(worktreePath, 'prompts/agents/builder.md', 'WORKTREE PROMPT')
    const worktreeManager = {
      enabled: true,
      cleanupOnSuccess: true,
      cleanupOnFailure: true,
      isGitRepo: vi.fn(() => true),
      create: vi.fn(async () => worktreePath),
      remove: vi.fn(),
      cleanupStale: vi.fn(async () => 0),
    } as unknown as WorktreeManager
    const fixture = createFixture({ repoPath, worktreeManager })
    fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: null,
      name: 'host-worktree',
      spec: { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readWrite' } },
    })
    fixture.context.agentRepo.update(fixture.builder.id, {
      resourceRefs: { sandboxRef: 'host-worktree', systemPromptRef: 'prompts/agents/builder.md' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const prompt = fixture.harness.spawn.mock.calls[0]?.[2] ?? ''
    const spawnOptions = fixture.harness.spawn.mock.calls[0]?.[4]

    expect(result.errors).toEqual([])
    expect(spawnOptions?.workingDir).toBe(worktreePath)
    expect(prompt).toContain('WORKTREE PROMPT')
  })

  it('resolves systemPromptRef from spawnConfig workingDir fallback', async () => {
    const agentDir = tmpRoot()
    writePrompt(agentDir, 'prompts/agents/builder.md', 'SPAWN CONFIG PROMPT')
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, {
      spawnConfig: { workingDir: agentDir },
      resourceRefs: { systemPromptRef: 'prompts/agents/builder.md' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const prompt = fixture.harness.spawn.mock.calls[0]?.[2] ?? ''

    expect(result.errors).toEqual([])
    expect(prompt).toContain('SPAWN CONFIG PROMPT')
    expect(fixture.harness.spawn.mock.calls[0]?.[4]?.workingDir).toBe(agentDir)
  })

  it.each([
    ['empty ref', '   ', null, 'must not be empty'],
    ['absolute ref', '/tmp/prompt.md', null, 'must be relative'],
    ['traversal ref', '../prompt.md', null, 'must stay under the run working directory'],
    ['missing file', 'prompts/missing.md', null, 'could not be read'],
    ['directory', 'prompts', (root: string) => mkdirSync(join(root, 'prompts'), { recursive: true }), 'must resolve to a file'],
    ['empty file', 'prompts/empty.md', (root: string) => writePrompt(root, 'prompts/empty.md', '   \n'), 'empty prompt file'],
    ['symlink escape', 'prompts/link.md', (root: string) => {
      const outside = join(tmpRoot(), 'outside.md')
      writeFileSync(outside, 'outside prompt')
      mkdirSync(join(root, 'prompts'), { recursive: true })
      symlinkSync(outside, join(root, 'prompts/link.md'))
    }, 'must stay under the run working directory'],
  ] as const)('fails loudly for %s without spawning or mapping a session', async (_name, ref, setup, expected) => {
    const repoPath = tmpRoot()
    setup?.(repoPath)
    const fixture = createFixture({ repoPath })
    const mappingCreate = vi.spyOn(fixture.context.sessionRunMappingRepo, 'create')
    fixture.context.agentRepo.update(fixture.builder.id, { resourceRefs: { systemPromptRef: ref } })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain(expected)
    expect(run.terminalState).toBe('stalled')
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
    expect(mappingCreate).not.toHaveBeenCalled()
    expect(fixture.context.sessionRunMappingRepo.getByRunId(run.id)).toBeNull()
  })

  it('fails loudly when a prompt ref has no resolved working directory', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, {
      spawnConfig: {},
      resourceRefs: { systemPromptRef: 'prompts/builder.md' },
    })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()

    expect(result.errors[0]?.error).toContain('requires a resolved working directory')
    expect(fixture.context.runRepo.list(task.id)[0]?.terminalState).toBe('stalled')
    expect(fixture.harness.spawn).not.toHaveBeenCalled()
  })

  it('preserves legacy prompt behavior when systemPromptRef is absent', async () => {
    const fixture = createFixture({ repoPath: tmpRoot() })
    const task = createTask(fixture)

    const result = await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!

    expect(result.errors).toEqual([])
    expect(fixture.harness.spawn.mock.calls[0]?.[2]).toBe('DISPATCHER PROMPT: call ductum_workflow before work.')
    expect(fixture.context.evidenceRepo.list(run.id)).toEqual([])
  })
})
