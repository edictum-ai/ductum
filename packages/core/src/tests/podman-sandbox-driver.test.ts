import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ContainerSandboxSpec, parseSandboxSpec, preparedSandbox, type SandboxPrepareBundle, type SandboxSpec } from '../sandbox-driver.js'
import { cleanupPodmanContainersForRuns, PodmanSandboxDriver, type PodmanCommandResult, type PodmanInvocation } from '../podman-sandbox-driver.js'
import { assertPodmanHarnessSupportsContainer } from '../podman-harness-support.js'
import { assertSupportedSandboxRuntime } from '../sandbox-runtime.js'
import { createId, type RunSandboxProfileSnapshot } from '../types.js'
import type { WorktreeManager } from '../worktree.js'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

const VERIFY_MARKER = 'DUCTUM_PODMAN_SANDBOX_OK'
const CONTAINER_WORKDIR = '/ductum/worktree'

const OK_VERSION: PodmanCommandResult = { status: 0, stdout: 'podman version 5.8.3', stderr: '' }
const OK_INSPECT: PodmanCommandResult = { status: 0, stdout: '[]', stderr: '' }
const OK_RUN: PodmanCommandResult = { status: 0, stdout: 'container-123\n', stderr: '' }
const OK_EXEC: PodmanCommandResult = { status: 0, stdout: VERIFY_MARKER, stderr: '' }

function profile(provider = 'podman', mode = 'container'): RunSandboxProfileSnapshot {
  return { id: 'sb-podman' as never, name: 'builder-podman', projectId: null, provider, mode, spec: { provider, mode } }
}

function podmanSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { provider: 'podman', mode: 'container', image: 'busybox:latest', ...overrides }
}

function containerSpec(overrides: Partial<ContainerSandboxSpec> = {}): ContainerSandboxSpec {
  return { kind: 'container', provider: 'podman', mode: 'container', image: 'busybox:latest', ...overrides }
}

function fakeWorktreeManager(path: string): Pick<WorktreeManager, 'enabled' | 'isGitRepo' | 'create' | 'remove'> {
  return { enabled: true, isGitRepo: () => true, create: async () => path, remove: async () => {} }
}

function recordingFake(responder: (args: readonly string[]) => PodmanCommandResult): { invocation: PodmanInvocation; calls: string[][] } {
  const calls: string[][] = []
  const invocation: PodmanInvocation = (args) => {
    calls.push([...args])
    return responder(args)
  }
  return { invocation, calls }
}

function okFake(): { invocation: PodmanInvocation; calls: string[][] } {
  return recordingFake((args) => {
    if (args[0] === '--version') return OK_VERSION
    if (args[0] === 'image') return OK_INSPECT
    if (args[0] === 'run') return OK_RUN
    if (args[0] === 'exec') return OK_EXEC
    if (args[0] === 'rm') return { status: 0, stdout: '', stderr: '' }
    return { status: 1, stdout: '', stderr: 'unexpected podman command' }
  })
}

function bundle(overrides: Partial<SandboxPrepareBundle<ContainerSandboxSpec>> = {}): SandboxPrepareBundle<ContainerSandboxSpec> {
  return {
    profile: profile(),
    spec: containerSpec(),
    runId: createId<'RunId'>(),
    taskName: 'task',
    baseWorkingDir: '/repo/ductum',
    worktreeManager: fakeWorktreeManager('/tmp/ductum-wt-1'),
    ...overrides,
  }
}

describe('podman sandbox driver', () => {
  describe('selection and boundary', () => {
    it('parses a podman/container spec into a container spec', () => {
      const spec = parseSandboxSpec(profile(), podmanSpec()) as SandboxSpec
      expect(spec.kind).toBe('container')
      expect(spec).toMatchObject({ kind: 'container', provider: 'podman', mode: 'container', image: 'busybox:latest' })
    })

    it('reports a truthful container boundary (only what the driver enforces)', () => {
      expect(new PodmanSandboxDriver().boundary()).toEqual({
        filesystem: 'worktree-readWrite',
        network: 'container-default',
        credentials: 'scoped',
        resources: 'none',
        process: 'namespaced',
      })
    })

    it('selects the podman driver at the runtime seam (assert accepts podman, rejects docker)', () => {
      expect(() => assertSupportedSandboxRuntime({ profile: profile(), resourceSpec: podmanSpec(), runId: createId<'RunId'>(), taskName: 't' })).not.toThrow()
      expect(() => assertSupportedSandboxRuntime({
        profile: profile('docker', 'container'),
        resourceSpec: { provider: 'docker', mode: 'container', image: 'x' },
        runId: createId<'RunId'>(), taskName: 't',
      })).toThrow('unsupported sandbox runtime docker/container')
    })

    it('fails closed for podman on harnesses that are not wired to podman exec', () => {
      const runtime = {
        sandboxProfile: profile(),
        harnessSnapshot: { spec: { supportedSandboxes: ['container'] } },
      } as never
      expect(() => assertPodmanHarnessSupportsContainer(runtime, { name: 'claude', harness: 'claude-agent-sdk' } as never))
        .toThrow('does not support podman/container sandbox execution')
      expect(() => assertPodmanHarnessSupportsContainer(runtime, { name: 'codex', harness: 'codex-sdk' } as never))
        .not.toThrow()
    })
  })

  describe('prepare happy path', () => {
    it('preflights podman + image, verifies the envelope, and returns the prepared sandbox', async () => {
      const fake = okFake()
      const driver = new PodmanSandboxDriver({ invocation: fake.invocation })
      const input = bundle()
      const prepared = await driver.prepare(input)
      expect(prepared.driver).toBe('container')
      expect(prepared.boundary).toEqual(new PodmanSandboxDriver().boundary())
      expect(prepared.workingDir).toBe('/tmp/ductum-wt-1')
      expect(prepared.worktreePaths).toEqual(['/tmp/ductum-wt-1'])
      expect(prepared.reusedWorktree).toBe(false)
      expect(prepared.podman?.containerId).toBe('container-123')

      expect(fake.calls[0]).toEqual(['--version'])
      expect(fake.calls[1]).toEqual(['image', 'inspect', '--', 'busybox:latest'])
      const runCall = fake.calls[2]!
      expect(runCall[0]).toBe('run')
      expect(runCall).toContain('-d')
      expect(runCall).not.toContain('--network')
      expect(runCall).toContain(`ductum.runtimeDir=/tmp/.podman-runtime-${input.runId.slice(0, 6)}`)
      expect(runCall).toContain(`${'/tmp/ductum-wt-1'}:${CONTAINER_WORKDIR}`)
      expect(runCall.includes('busybox:latest')).toBe(true)
      expect(fake.calls[3]?.[0]).toBe('exec')
    })

    it('reuses an inherited worktree without creating a new one', async () => {
      const inherited = mkdtempSync(join(tmpdir(), 'ductum-podman-inherited-'))
      cleanup.push(() => rmSync(inherited, { recursive: true, force: true }))
      const fake = okFake()
      const driver = new PodmanSandboxDriver({ invocation: fake.invocation })
      const prepared = await driver.prepare(bundle({ inheritedWorktreePaths: [inherited], baseWorkingDir: undefined, worktreeManager: undefined }))
      expect(prepared.reusedWorktree).toBe(true)
      expect(prepared.workingDir).toBe(inherited)
      expect(fake.calls[2]![fake.calls[2]!.indexOf('-v') + 1]).toBe(`${inherited}:${CONTAINER_WORKDIR}`)
    })

    it('teardown removes the long-lived container', () => {
      const fake = okFake()
      const driver = new PodmanSandboxDriver({ invocation: fake.invocation })
      expect(() => driver.teardown({ ...preparedSandbox(profile(), 'container', '/x', ['/x'], false, new PodmanSandboxDriver().boundary()), podman: { containerId: 'container-123', command: 'podman', workdir: CONTAINER_WORKDIR } })).not.toThrow()
      expect(fake.calls.at(-1)).toEqual(['rm', '-f', '--', 'container-123'])
    })
  })

  describe('stale container cleanup', () => {
    it('removes containers labelled for stale run ids', () => {
      const fake = recordingFake((args) => {
        if (args[0] === 'ps') return { status: 0, stdout: 'c1\nc2\n', stderr: '' }
        if (args[0] === 'inspect') return { status: 0, stdout: '/tmp/runtime-dir\n', stderr: '' }
        if (args[0] === 'rm') return { status: 0, stdout: '', stderr: '' }
        return { status: 1, stdout: '', stderr: 'unexpected' }
      })
      cleanupPodmanContainersForRuns(['run-1'], fake.invocation)
      expect(fake.calls).toEqual([
        ['ps', '-a', '--filter', 'label=ductum.sandbox=podman', '--filter', 'label=ductum.run=run-1', '--format', '{{.ID}}'],
        ['inspect', '--format', '{{ index .Config.Labels "ductum.runtimeDir" }}', '--', 'c1'],
        ['rm', '-f', '--', 'c1'],
        ['inspect', '--format', '{{ index .Config.Labels "ductum.runtimeDir" }}', '--', 'c2'],
        ['rm', '-f', '--', 'c2'],
      ])
    })

    it('does nothing when no podman run ids are supplied', () => {
      const fake = recordingFake(() => ({ status: 1, stdout: '', stderr: 'unexpected' }))
      cleanupPodmanContainersForRuns([], fake.invocation)
      expect(fake.calls).toEqual([])
    })
  })

  describe('fail-closed preflight / runtime', () => {
    it('fails when the podman binary is unavailable', async () => {
      const driver = new PodmanSandboxDriver({ invocation: recordingFake(() => ({ status: 127, stdout: '', stderr: 'command not found' })).invocation })
      await expect(driver.prepare(bundle())).rejects.toThrow('podman command to be available')
    })

    it('fails when the podman binary cannot be executed (ENOENT / null status)', async () => {
      const driver = new PodmanSandboxDriver({ invocation: recordingFake(() => ({ status: null, stdout: '', stderr: '' })).invocation })
      await expect(driver.prepare(bundle())).rejects.toThrow('podman command to be available')
    })

    it('fails when the image is missing or the engine is not running', async () => {
      const driver = new PodmanSandboxDriver({
        invocation: recordingFake((args) => (args[0] === '--version' ? OK_VERSION : { status: 1, stdout: '', stderr: 'no such image' })).invocation,
      })
      await expect(driver.prepare(bundle())).rejects.toThrow('requires podman image "busybox:latest"')
    })

    it('fails when the envelope verification does not produce the marker, and cleans up the created worktree', async () => {
      const remove = vi.fn(async () => {})
      const driver = new PodmanSandboxDriver({
        invocation: recordingFake((args) => {
          if (args[0] === 'run') return OK_RUN
          if (args[0] === 'exec') return { status: 0, stdout: '', stderr: '' }
          return args[0] === '--version' ? OK_VERSION : OK_INSPECT
        }).invocation,
      })
      await expect(driver.prepare(bundle({ worktreeManager: { enabled: true, isGitRepo: () => true, create: async () => '/tmp/ductum-wt-1', remove } as never })))
        .rejects.toThrow('could not verify the podman sandbox envelope')
      expect(remove).toHaveBeenCalledWith('/tmp/ductum-wt-1')
    })

    it('does not create or clean up a worktree when the preflight fails before worktree creation', async () => {
      const create = vi.fn(async () => '/tmp/ductum-wt-1')
      const remove = vi.fn(async () => {})
      const driver = new PodmanSandboxDriver({ invocation: recordingFake(() => ({ status: 127, stdout: '', stderr: 'not found' })).invocation })
      await expect(driver.prepare(bundle({ worktreeManager: { enabled: true, isGitRepo: () => true, create, remove } as never })))
        .rejects.toThrow('podman command to be available')
      expect(create).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })

    it('fails when imageInspect reports the image absent after a missing-image parse slip', async () => {
      const driver = new PodmanSandboxDriver({
        invocation: recordingFake((args) => (args[0] === '--version' ? OK_VERSION : { status: 1, stdout: '', stderr: 'not found' })).invocation,
      })
      await expect(driver.prepare(bundle({ spec: containerSpec({ image: 'missing:9999' }) }))).rejects.toThrow('requires podman image "missing:9999"')
    })

    it('fails when the worktree manager is unavailable', async () => {
      const driver = new PodmanSandboxDriver({ invocation: okFake().invocation })
      await expect(driver.prepare(bundle({ worktreeManager: undefined, baseWorkingDir: undefined }))).rejects.toThrow('requires an enabled Ductum worktree manager')
    })
  })

  describe('unsupported claims fail honestly', () => {
    it.each([
      ['docker provider', { provider: 'docker', mode: 'container', image: 'x' }, 'unsupported sandbox runtime docker/container'],
      ['local provider', { provider: 'local', mode: 'permissive' }, 'unsupported sandbox runtime local/permissive'],
      ['remote kind', { kind: 'remote', provider: 'e2b', mode: 'remote' }, 'unsupported sandbox runtime e2b/remote'],
      ['missing image', { provider: 'podman', mode: 'container' }, 'requires spec.image'],
      ['blank image', { provider: 'podman', mode: 'container', image: '  ' }, 'requires spec.image'],
      ['image begins with dash', { provider: 'podman', mode: 'container', image: '-evil' }, 'does not support spec.image values that begin with "-"'],
      ['read-only worktree', { provider: 'podman', mode: 'container', image: 'x', filesystem: { worktree: 'readOnly' } }, 'does not support filesystem.worktree=readOnly'],
      ['extra filesystem key', { provider: 'podman', mode: 'container', image: 'x', filesystem: { tmpfs: ['/tmp'] } }, 'does not support filesystem.tmpfs'],
      ['network none', { provider: 'podman', mode: 'container', image: 'x', network: { mode: 'none' } }, 'does not support network.mode=none'],
      ['network egress-allowlist', { provider: 'podman', mode: 'container', image: 'x', network: { mode: 'egress-allowlist' } }, 'does not support network.mode=egress-allowlist'],
      ['network allowlist', { provider: 'podman', mode: 'container', image: 'x', network: { allowlist: ['1.1.1.1'] } }, 'does not support network.allowlist'],
      ['resources cpu', { provider: 'podman', mode: 'container', image: 'x', resources: { cpu: 2 } }, 'does not support spec.resources'],
      ['resources memory', { provider: 'podman', mode: 'container', image: 'x', resources: { memoryMb: 512 } }, 'does not support spec.resources'],
      ['process user', { provider: 'podman', mode: 'container', image: 'x', process: { user: 'root' } }, 'does not support process.user'],
      ['credentials host mode', { provider: 'podman', mode: 'container', image: 'x', credentials: { mode: 'host' } }, 'does not support credentials.mode=host'],
    ] as const)('rejects %s', (_name, spec, expected) => {
      const provider = (spec as { provider?: string }).provider ?? 'podman'
      const mode = (spec as { mode?: string }).mode ?? 'container'
      expect(() => parseSandboxSpec(profile(provider, mode), spec)).toThrow(expected as string)
    })

    it('accepts the explicit truthful podman network mode', () => {
      expect(parseSandboxSpec(profile(), podmanSpec({ network: { mode: 'container-default' } }))).toMatchObject({
        network: { mode: 'container-default' },
      })
    })
  })
})
