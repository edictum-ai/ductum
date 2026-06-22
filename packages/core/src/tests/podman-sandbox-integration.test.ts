/**
 * Real-Podman integration for the container sandbox driver.
 *
 * Gated behind `DUCTUM_PODMAN_INTEGRATION=1` and a reachable engine, so the
 * default suite stays deterministic. Point at a non-PATH binary with
 * `DUCTUM_PODMAN_COMMAND=/opt/podman/bin/podman` and pick an image with
 * `DUCTUM_PODMAN_TEST_IMAGE=busybox:latest`.
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type DispatcherMcpServer, type HarnessAdapter } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { PodmanSandboxDriver } from '../podman-sandbox-driver.js'
import type { ConfigResource } from '../resource-types.js'
import { RunStateMachine } from '../state-machine.js'
import { createId } from '../types.js'
import type { WatcherManager } from '../watcher-manager.js'
import { WorktreeManager } from '../worktree.js'
import { createRepoContext, seedBase } from './helpers.js'

const INTEGRATION = process.env.DUCTUM_PODMAN_INTEGRATION === '1'
const PODMAN_COMMAND = process.env.DUCTUM_PODMAN_COMMAND?.trim() || 'podman'
const TEST_IMAGE = process.env.DUCTUM_PODMAN_TEST_IMAGE?.trim() || 'busybox:latest'

function engineUp(): boolean {
  if (!INTEGRATION) return false
  try {
    const result = spawnSync(PODMAN_COMMAND, ['ps'], { encoding: 'utf8', timeout: 20_000 })
    return result.status === 0
  } catch {
    return false
  }
}

const ENGINE_UP = engineUp()

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ductum-podman-${prefix}-`))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function initGitRepo(dir: string): void {
  execSync('git init -q', { cwd: dir })
  execSync('git config user.email t@ductum.dev && git config user.name ductum', { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# repo\n')
  execSync('git add -A && git commit -q -m init', { cwd: dir })
}

function podmanContainerCount(): number {
  const result = spawnSync(PODMAN_COMMAND, ['ps', '-a', '--filter', 'label=ductum.sandbox=podman', '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 20_000 })
  if (result.status !== 0) throw new Error(result.stderr || 'podman ps failed')
  return result.stdout.trim() === '' ? 0 : result.stdout.trim().split(/\n/).length
}

describe.skipIf(!ENGINE_UP)('podman sandbox driver integration (real podman)', () => {
  it('preflights podman + image and verifies the envelope against a real worktree mount', async () => {
    const before = podmanContainerCount()
    const worktree = makeTempDir('wt')
    writeFileSync(join(worktree, 'probe.txt'), 'host-content')
    const driver = new PodmanSandboxDriver()
    const prepared = await driver.prepare({
      profile: { id: 'sb' as never, name: 'podman-it', projectId: null, provider: 'podman', mode: 'container', spec: {} },
      spec: { kind: 'container', provider: 'podman', mode: 'container', image: TEST_IMAGE },
      runId: createId<'RunId'>(), taskName: 'it', baseWorkingDir: makeTempDir('repo'),
      worktreeManager: { enabled: true, isGitRepo: () => true, create: async () => worktree } as never,
    })
    expect(prepared.driver).toBe('container')
    expect(prepared.boundary).toEqual({
      filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced',
    })
    // The driver resolves the worktree to its real path (no symlinks) so Podman's
    // VM bind-mount layer can stat it. On macOS /tmp is a symlink → /private/tmp.
    expect(prepared.workingDir).toBe(realpathSync(worktree))
    expect(podmanContainerCount()).toBe(before + 1)
    driver.teardown(prepared)
    expect(podmanContainerCount()).toBe(before)
  })

  it('fails closed when the requested image is not present', async () => {
    const worktree = makeTempDir('wt-missing')
    const driver = new PodmanSandboxDriver()
    await expect(driver.prepare({
      profile: { id: 'sb' as never, name: 'podman-it', projectId: null, provider: 'podman', mode: 'container', spec: {} },
      spec: { kind: 'container', provider: 'podman', mode: 'container', image: 'ductum/definitely-not-a-real-image:9999' },
      runId: createId<'RunId'>(), taskName: 'it', baseWorkingDir: makeTempDir('repo-missing'),
      worktreeManager: { enabled: true, isGitRepo: () => true, create: async () => worktree } as never,
    })).rejects.toThrow('requires podman image "ductum/definitely-not-a-real-image:9999"')
  })

  it('runs a real task through the dispatcher seam and selects the podman driver', async () => {
    const before = podmanContainerCount()
    const repo = makeTempDir('repo')
    initGitRepo(repo)
    const worktreeManager = new WorktreeManager({ enabled: true, basePath: makeTempDir('wtbase') })
    const context = createRepoContext()
    cleanup.push(() => context.db.close())
    const { builder, spec } = seedBase(context)
    const eventEmitter = new DuctumEventEmitter()
    const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, eventEmitter)
    const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, eventEmitter, { now: () => new Date('2026-06-18T12:00:00Z') })
    const hostMarker = join(repo, 'agent-contained-marker')
    const spawn = vi.fn<HarnessAdapter['spawn']>(async (run, _task, _prompt, _mcp, options) => {
      const podman = options?.sandbox?.podman
      if (podman == null) throw new Error('missing podman sandbox')
      const marker = 'agent-contained-marker'
      const exec = spawnSync(podman.command, ['exec', '-w', podman.workdir, '--', podman.containerId, 'sh', '-c', `printf contained > ${marker}`], { encoding: 'utf8', timeout: 20_000 })
      if (exec.status !== 0) throw new Error(exec.stderr || 'podman exec marker failed')
      expect(existsSync(join(options?.workingDir ?? '', marker))).toBe(true)
      expect(existsSync(hostMarker)).toBe(false)
      return {
        sessionId: `s-${run.id}`, runId: run.id,
        sandboxExecution: { agentProcess: 'podman-container', containerId: podman.containerId, workdir: podman.workdir },
        waitForCompletion: async () => ({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 }),
      }
    })
    const adapter: HarnessAdapter = { spawn, kill: vi.fn(), isAlive: vi.fn(async () => true) }
    const watcherManager = { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager
    const sandbox: ConfigResource = context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(), kind: 'SandboxProfile', projectId: null, name: 'podman-it',
      spec: { provider: 'podman', mode: 'container', image: TEST_IMAGE },
    })
    const harness = context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'podman-capable-test-harness',
      spec: { type: 'codex-sdk', supportedSandboxes: ['container'] },
    })
    context.agentRepo.update(builder.id, { resourceRefs: { sandboxRef: sandbox.name, harnessRef: harness.name } })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(), specId: spec.id, name: 'podman dispatch', prompt: 'do',
      repos: ['packages/core'], assignedAgentId: builder.id, status: 'ready', verification: ['pnpm test'],
    })
    const dispatcher = new Dispatcher(
      dag, context.runRepo, context.taskRepo, context.agentRepo, context.projectAgentRepo,
      context.specRepo, context.projectRepo, stateMachine, watcherManager, context.sessionRunMappingRepo,
      new Map([['codex-sdk', adapter]]), eventEmitter,
      {
        pollIntervalMs: 1_000, maxConcurrentRuns: 3, now: () => new Date('2026-06-18T12:00:00Z'),
        buildSystemPrompt: (task) => `p:${task.id}`,
        createMcpServer: async () => ({ close: vi.fn() }) satisfies DispatcherMcpServer,
        resolveRepoPath: () => repo,
      },
      worktreeManager, undefined, context.configResourceRepo, context.evidenceRepo,
    )

    const result = await dispatcher.cycle()
    expect(result.errors).toEqual([])
    const spawnOptions = spawn.mock.calls[0]?.[4]
    expect(spawnOptions?.sandbox?.driver).toBe('container')
    expect(spawnOptions?.sandbox?.boundary).toEqual({
      filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced',
    })
    const run = context.runRepo.list(task.id)[0]!
    expect(context.evidenceRepo.list(run.id).map((item) => item.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'runtime.sandbox.prepared', agentExecution: expect.objectContaining({ mode: 'prepared-container-only' }) }),
      expect.objectContaining({ kind: 'runtime.sandbox.agent_execution', agentExecution: expect.objectContaining({ mode: 'agent-contained' }) }),
    ]))
    await vi.waitFor(() => {
      expect(context.runRepo.get(run.id)?.terminalState).toBe('stalled')
      expect(podmanContainerCount()).toBe(before)
    }, { timeout: 10_000 })
  })
})
