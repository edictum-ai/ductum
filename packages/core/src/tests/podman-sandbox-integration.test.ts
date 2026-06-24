/**
 * Real-Podman integration for the container sandbox driver.
 *
 * Gated behind `DUCTUM_PODMAN_INTEGRATION=1` and a reachable engine, so the
 * default suite stays deterministic. Point at a non-PATH binary with
 * `DUCTUM_PODMAN_COMMAND=/opt/podman/bin/podman` and pick an image with
 * `DUCTUM_PODMAN_TEST_IMAGE=busybox:latest`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PodmanSandboxDriver } from '../podman-sandbox-driver.js'
import { confirmedSandboxAgentExecution } from '../sandbox-execution-evidence.js'
import { createId } from '../types.js'

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

  it('proves a real command runs inside the prepared container and not at the original host repo path', async () => {
    const before = podmanContainerCount()
    const repo = makeTempDir('repo')
    const worktree = makeTempDir('wt-dispatch')
    const hostMarker = join(repo, 'agent-contained-marker')
    const driver = new PodmanSandboxDriver()
    const prepared = await driver.prepare({
      profile: { id: 'sb' as never, name: 'podman-it', projectId: null, provider: 'podman', mode: 'container', spec: {} },
      spec: { kind: 'container', provider: 'podman', mode: 'container', image: TEST_IMAGE },
      runId: createId<'RunId'>(),
      taskName: 'podman dispatch',
      baseWorkingDir: repo,
      worktreeManager: { enabled: true, isGitRepo: () => true, create: async () => worktree } as never,
    })
    try {
      const podman = prepared.podman
      if (podman == null || podman.proof == null) throw new Error('missing podman proof metadata')
      const marker = 'agent-contained-marker'
      const proofPayload = JSON.stringify({
        kind: 'ductum-podman-agent-launch-proof',
        runId: podman.runId,
        containerId: podman.containerId,
        workdir: podman.workdir,
        nonce: podman.proof.nonce,
      })
      const exec = spawnSync(podman.command, ['exec', '-w', podman.workdir, '--', podman.containerId, 'sh', '-c', `printf contained > ${marker} && printf '%s' '${proofPayload}' > '${podman.proof.filePath}'`], { encoding: 'utf8', timeout: 20_000 })
      if (exec.status !== 0) throw new Error(exec.stderr || 'podman exec marker failed')
      expect(existsSync(join(prepared.workingDir, marker))).toBe(true)
      expect(existsSync(hostMarker)).toBe(false)
      expect(confirmedSandboxAgentExecution(prepared, {
        sessionId: `s-${podman.runId}`,
        runId: podman.runId as never,
        sandboxExecution: { agentProcess: 'podman-container', containerId: podman.containerId, workdir: podman.workdir },
        waitForCompletion: async () => ({ exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0 }),
      })).toMatchObject({
        mode: 'agent-contained',
        container: {
          containerId: podman.containerId,
          proof: {
            runId: podman.runId,
            hostWorktree: prepared.workingDir,
            markerFile: podman.proof.filePath,
          },
        },
      })
    } finally {
      driver.teardown(prepared)
    }
    expect(podmanContainerCount()).toBe(before)
  })
})
