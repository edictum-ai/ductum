import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type ContainerSandboxSpec, parseSandboxSpec, preparedSandbox, type SandboxPrepareBundle, type SandboxSpec } from '../sandbox-driver.js'
import { PodmanSandboxDriver, type PodmanCommandResult, type PodmanInvocation } from '../podman-sandbox-driver.js'
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
const OK_RUN: PodmanCommandResult = { status: 0, stdout: VERIFY_MARKER, stderr: '' }

function profile(provider = 'podman', mode = 'container'): RunSandboxProfileSnapshot {
  return { id: 'sb-podman' as never, name: 'builder-podman', projectId: null, provider, mode, spec: { provider, mode } }
}

function podmanSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { provider: 'podman', mode: 'container', image: 'busybox:latest', ...overrides }
}

function containerSpec(overrides: Partial<ContainerSandboxSpec> = {}): ContainerSandboxSpec {
  return { kind: 'container', provider: 'podman', mode: 'container', image: 'busybox:latest', ...overrides }
}

function fakeWorktreeManager(path: string): Pick<WorktreeManager, 'enabled' | 'isGitRepo' | 'create'> {
  return { enabled: true, isGitRepo: () => true, create: async () => path }
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
        network: 'none',
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
  })

  describe('prepare happy path', () => {
    it('preflights podman + image, verifies the envelope, and returns the prepared sandbox', async () => {
      const fake = okFake()
      const driver = new PodmanSandboxDriver({ invocation: fake.invocation })
      const prepared = await driver.prepare(bundle())
      expect(prepared.driver).toBe('container')
      expect(prepared.boundary).toEqual(new PodmanSandboxDriver().boundary())
      expect(prepared.workingDir).toBe('/tmp/ductum-wt-1')
      expect(prepared.worktreePaths).toEqual(['/tmp/ductum-wt-1'])
      expect(prepared.reusedWorktree).toBe(false)

      expect(fake.calls[0]).toEqual(['--version'])
      expect(fake.calls[1]).toEqual(['image', 'inspect', '--', 'busybox:latest'])
      const runCall = fake.calls[2]!
      expect(runCall[0]).toBe('run')
      expect(runCall).toContain('--rm')
      const netIdx = runCall.indexOf('--network')
      expect(netIdx).toBeGreaterThan(-1)
      expect(runCall[netIdx + 1]).toBe('none')
      expect(runCall).toContain(`${'/tmp/ductum-wt-1'}:${CONTAINER_WORKDIR}`)
      expect(runCall.includes('busybox:latest')).toBe(true)
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

    it('teardown is a no-op (the verification container self-removes via --rm)', () => {
      const driver = new PodmanSandboxDriver({ invocation: okFake().invocation })
      expect(() => driver.teardown(preparedSandbox(profile(), 'container', '/x', ['/x'], false, new PodmanSandboxDriver().boundary()))).not.toThrow()
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

    it('fails when the envelope verification does not produce the marker', async () => {
      const driver = new PodmanSandboxDriver({
        invocation: recordingFake((args) => {
          if (args[0] === 'run') return { status: 0, stdout: '', stderr: '' }
          return args[0] === '--version' ? OK_VERSION : OK_INSPECT
        }).invocation,
      })
      await expect(driver.prepare(bundle())).rejects.toThrow('could not verify the podman sandbox envelope')
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
  })
})
