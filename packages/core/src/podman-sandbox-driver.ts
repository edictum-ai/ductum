import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { preparedSandbox, type PreparedSandbox, type SandboxBoundaryDescriptor, type SandboxDriver, type SandboxPrepareBundle, type ContainerSandboxSpec } from './sandbox-driver.js'
import { cleanupPodmanContainersForRuns, podmanFailureDetail, removeRuntimeDirBestEffort } from './podman-sandbox-driver-support.js'
import { podmanBoundary, sandboxError } from './sandbox-spec-helpers.js'
import type { RunSandboxProfileSnapshot } from './types.js'

/**
 * Real Podman container sandbox driver.
 *
 * Proves the {@link SandboxDriver} seam with a second, non-host driver without
 * weakening host behavior or claiming isolation it does not enforce. Podman is
 * preferred because it can run rootless and daemonless.
 *
 * What this driver actually enforces, and therefore what its boundary
 * descriptor truthfully reports (see {@link podmanBoundary}):
 *   - the agent worktree is bind-mounted writable into a real container;
 *   - the container runs with Podman's default container networking, which is
 *     required until the Codex MCP/model routes have a proxy/allowlist;
 *   - the container has its own PID namespace;
 *   - credentials must arrive through an explicit scoped Codex home; the
 *     harness fails closed instead of copying ambient CODEX_HOME or ~/.codex
 *     into the container.
 *
 * Fail-closed contract: `prepare` throws a clear `resource_malformed` error
 * when the podman binary is missing, the engine is unreachable, the requested
 * image is absent, or the live container cannot mount/verify the worktree.
 *
 * Lifecycle note: `prepare` now creates a long-lived container so harness
 * adapters can run the agent command with `podman exec`. The dispatcher wires
 * this driver's `teardown` through every session release path.
 */

export interface PodmanCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export { cleanupPodmanContainersForRuns, type PodmanCleanupResult } from './podman-sandbox-driver-support.js'

/** Synchronous podman invocation; overridable so the driver is unit-testable. */
export type PodmanInvocation = (args: readonly string[]) => PodmanCommandResult

const PODMAN_CONTAINER_WORKDIR = '/ductum/worktree'
const PODMAN_RUNTIME_DIR = '/ductum/runtime'
const PODMAN_VERIFY_MARKER = 'DUCTUM_PODMAN_SANDBOX_OK'
const PODMAN_AGENT_PROOF_FILE = `${PODMAN_RUNTIME_DIR}/agent-launch-proof.json`
const PODMAN_INVOKE_TIMEOUT_MS = 30_000
const PODMAN_KEEPALIVE = 'trap "exit 0" TERM INT; while :; do sleep 3600 & wait $!; done'

/**
 * Resolve the podman binary. Honors `DUCTUM_PODMAN_COMMAND` (e.g.
 * `/opt/podman/bin/podman`) so podman need not be on `PATH`. This is a
 * control-plane config var, not an agent secret, so reading `process.env`
 * here does not touch the scoped-secret broker discipline.
 */
export function resolvePodmanCommand(): string {
  const fromEnv = process.env.DUCTUM_PODMAN_COMMAND?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'podman'
}

export const defaultPodmanInvocation: PodmanInvocation = (args) => {
  const result = spawnSync(resolvePodmanCommand(), [...args], {
    encoding: 'utf8',
    timeout: PODMAN_INVOKE_TIMEOUT_MS,
  })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

export class PodmanSandboxDriver implements SandboxDriver<ContainerSandboxSpec> {
  readonly id = 'container' as const
  private readonly invocation: PodmanInvocation

  constructor(options: { invocation?: PodmanInvocation } = {}) {
    this.invocation = options.invocation ?? defaultPodmanInvocation
  }

  boundary(): SandboxBoundaryDescriptor {
    return { ...podmanBoundary }
  }

  async prepare(bundle: SandboxPrepareBundle<ContainerSandboxSpec>): Promise<PreparedSandbox> {
    const run = (args: readonly string[]): PodmanCommandResult => this.invocation(args)

    // Preflight the cheap, side-effect-free checks BEFORE creating a worktree,
    // so a misconfigured podman binary or missing image does not orphan a
    // managed worktree that cancel/failure cleanup cannot see (the worktree is
    // only tracked on the run once prepare returns successfully).
    const version = run(['--version'])
    if (version.status !== 0 || version.stdout.trim() === '') {
      throw sandboxError(bundle.profile, 'requires the podman command to be available (set DUCTUM_PODMAN_COMMAND or add podman to PATH)')
    }
    const image = bundle.spec.image
    if (image == null || image.trim() === '') {
      throw sandboxError(bundle.profile, 'requires spec.image to name a podman image')
    }
    const inspect = run(['image', 'inspect', '--', image])
    if (inspect.status !== 0) {
      throw sandboxError(bundle.profile, `requires podman image "${image}" to be present and the podman engine to be running (try \`podman machine start\`)`)
    }

    const worktree = await resolvePodmanWorktree(bundle)
    const hostWorktree = resolvePodmanMountPath(worktree.path)
    const runtimeHostDir = createRuntimeHostDir(hostWorktree, bundle.runId)
    const proof = { filePath: PODMAN_AGENT_PROOF_FILE, nonce: randomUUID() }
    let containerId: string
    try {
      containerId = startContainer(bundle.profile, run, image, hostWorktree, runtimeHostDir, bundle.runId, proof)
      assertEnvelopeVerified(bundle.profile, run, containerId)
    } catch (error) {
      // The envelope probe is the only step that can fail after the worktree is
      // created; clean it up so it does not leak when the mount/verify fails.
      if (!isPodmanCleanupUncertain(error)) {
        removeRuntimeDirBestEffort(runtimeHostDir)
        if (worktree.createdByPrepare) await removeWorktreeBestEffort(bundle.worktreeManager, hostWorktree)
      }
      throw error
    }

    const reused = (bundle.inheritedWorktreePaths?.length ?? 0) > 0
    return {
      ...preparedSandbox(bundle.profile, this.id, hostWorktree, [hostWorktree], reused, { ...podmanBoundary }),
      podman: {
        containerId,
        runId: bundle.runId,
        command: resolvePodmanCommand(),
        workdir: PODMAN_CONTAINER_WORKDIR,
        runtimeHostDir,
        runtimeDir: PODMAN_RUNTIME_DIR,
        proof,
      },
    }
  }

  teardown(prepared: PreparedSandbox): void {
    const containerId = prepared.podman?.containerId
    if (containerId != null && containerId.trim() !== '') {
      const removed = this.invocation(['rm', '-f', '--', containerId])
      if (removed.status !== 0) {
        throw new Error(`podman cleanup failed for container ${containerId}: ${podmanFailureDetail(removed)}`)
      }
    }
    if (prepared.podman?.runtimeHostDir != null) removeRuntimeDirBestEffort(prepared.podman.runtimeHostDir)
  }
}

async function resolvePodmanWorktree(bundle: SandboxPrepareBundle<ContainerSandboxSpec>): Promise<{ path: string; createdByPrepare: boolean }> {
  const inherited = bundle.inheritedWorktreePaths ?? []
  if (inherited.length > 0) {
    const path = inherited[0]
    if (path == null || path.trim() === '') {
      throw sandboxError(bundle.profile, 'requires a non-empty inherited worktree path')
    }
    if (!existsSync(path)) {
      throw sandboxError(bundle.profile, `inherited worktree path no longer exists: ${path}`)
    }
    return { path, createdByPrepare: false }
  }

  const { worktreeManager, baseWorkingDir } = bundle
  if (worktreeManager == null || baseWorkingDir == null) {
    throw sandboxError(bundle.profile, 'requires an enabled Ductum worktree manager and working directory')
  }
  if (!worktreeManager.enabled) {
    throw sandboxError(bundle.profile, 'requires an enabled Ductum worktree manager')
  }
  if (!worktreeManager.isGitRepo(baseWorkingDir)) {
    throw sandboxError(bundle.profile, `requires a git repository working directory: ${baseWorkingDir}`)
  }

  const worktreePath = await worktreeManager.create(
    baseWorkingDir,
    bundle.taskName,
    bundle.runId,
    bundle.projectName,
    bundle.setupCommands,
    bundle.setupEnv,
  )
  if (worktreePath.trim() === '' || worktreePath === baseWorkingDir) {
    throw sandboxError(bundle.profile, `failed to create a Ductum-managed worktree for ${baseWorkingDir}`)
  }
  return { path: worktreePath, createdByPrepare: true }
}

async function removeWorktreeBestEffort(
  manager: { remove?(worktreePath: string): Promise<void> | void } | undefined,
  worktreePath: string,
): Promise<void> {
  if (manager == null) return
  try {
    await manager.remove?.(worktreePath)
  } catch {
    // Best-effort: a failed cleanup must not swallow the real preparation error.
    // Orphaned worktrees are also reclaimed by the stale-worktree GC.
  }
}

/**
 * Start the long-lived container that will host agent side effects. It is
 * intentionally narrow: writable worktree mount, namespaced process table,
 * and no host environment beyond Podman's own invocation. It intentionally
 * uses Podman's default network so the contained Codex process can reach the
 * host MCP endpoint and model provider APIs.
 */
function startContainer(
  profile: RunSandboxProfileSnapshot,
  run: (args: readonly string[]) => PodmanCommandResult,
  image: string,
  hostWorktree: string,
  runtimeHostDir: string,
  runId: string,
  proof: { filePath: string; nonce: string },
): string {
  const verify = run([
    'run', '-d',
    '--label', 'ductum.sandbox=podman',
    '--label', `ductum.run=${runId}`,
    '--label', `ductum.hostWorktree=${hostWorktree}`,
    '--label', `ductum.runtimeDir=${runtimeHostDir}`,
    '--label', `ductum.proofFile=${proof.filePath}`,
    '--label', `ductum.proofNonce=${proof.nonce}`,
    '-v', `${hostWorktree}:${PODMAN_CONTAINER_WORKDIR}`,
    '-v', `${runtimeHostDir}:${PODMAN_RUNTIME_DIR}`,
    '-w', PODMAN_CONTAINER_WORKDIR,
    '--', image, 'sh', '-c', PODMAN_KEEPALIVE,
  ])
  const containerId = verify.stdout.trim().split(/\s+/)[0] ?? ''
  if (verify.status !== 0 || containerId === '') {
    const cleanup = cleanupPodmanContainersForRuns([runId], run)
    const detail = verify.stderr.trim() || `exit status ${verify.status ?? 'null'}`
    const cleanupFailed = cleanup.failed.length > 0 || cleanup.listFailed.length > 0
    const error = sandboxError(profile, `could not start the podman sandbox container for ${hostWorktree}: ${detail}${cleanupFailed ? '; podman label cleanup incomplete' : ''}`)
    if (cleanupFailed) markPodmanCleanupUncertain(error)
    throw error
  }
  return containerId
}

function assertEnvelopeVerified(
  profile: RunSandboxProfileSnapshot,
  run: (args: readonly string[]) => PodmanCommandResult,
  containerId: string,
): void {
  const verify = run([
    'exec', '-w', PODMAN_CONTAINER_WORKDIR, '--', containerId, 'sh', '-c',
    `test -d ${PODMAN_CONTAINER_WORKDIR} && test -w ${PODMAN_CONTAINER_WORKDIR} && test -d ${PODMAN_RUNTIME_DIR} && test -w ${PODMAN_RUNTIME_DIR} && echo ${PODMAN_VERIFY_MARKER}`,
  ])
  if (verify.status !== 0 || !verify.stdout.includes(PODMAN_VERIFY_MARKER)) {
    const removed = run(['rm', '-f', '--', containerId])
    const detail = verify.stderr.trim() || `exit status ${verify.status ?? 'null'}`
    const error = sandboxError(profile, `could not verify the podman sandbox envelope in container ${containerId}: ${detail}`)
    if (removed.status !== 0) markPodmanCleanupUncertain(error)
    throw error
  }
}

/** Resolve symlinks in a mount-source path; falls back on ENOENT (unit-test fake paths). */
function resolvePodmanMountPath(path: string): string { try { return realpathSync(path) } catch { return path } }
function createRuntimeHostDir(hostWorktree: string, runId: string): string {
  const safeRunId = runId.slice(0, 6).replace(/[^A-Za-z0-9_.-]/g, '_')
  const runtimeHostDir = join(dirname(hostWorktree), `.podman-runtime-${safeRunId}`)
  mkdirSync(runtimeHostDir, { recursive: true, mode: 0o700 })
  return runtimeHostDir
}

function markPodmanCleanupUncertain(error: Error): void { ;(error as Error & { podmanCleanupUncertain: true }).podmanCleanupUncertain = true }

function isPodmanCleanupUncertain(error: unknown): boolean { return error != null && typeof error === 'object' && (error as { podmanCleanupUncertain?: unknown }).podmanCleanupUncertain === true }
