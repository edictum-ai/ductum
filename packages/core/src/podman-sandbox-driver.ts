import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { preparedSandbox, type PreparedSandbox, type SandboxBoundaryDescriptor, type SandboxDriver, type SandboxPrepareBundle, type ContainerSandboxSpec } from './sandbox-driver.js'
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
 *   - the container runs with `--network none` (no network egress);
 *   - the container has its own PID namespace;
 *   - credentials come from the scoped secret broker, never `process.env`.
 *
 * Fail-closed contract: `prepare` throws a clear `resource_malformed` error
 * when the podman binary is missing, the engine is unreachable, the requested
 * image is absent, or the live container cannot mount/verify the worktree.
 *
 * Lifecycle note: the dispatcher does not currently invoke `teardown`, so a
 * long-lived container would leak. `prepare` therefore verifies the isolation
 * envelope with a real but ephemeral (`--rm`) container that podman removes as
 * soon as the probe exits, leaving nothing to tear down. Routing the agent
 * process itself into a kept-alive container is a follow-up that needs harness
 * adapter work (no adapter reads `spawnOptions.sandbox` today).
 */

export interface PodmanCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Synchronous podman invocation; overridable so the driver is unit-testable. */
export type PodmanInvocation = (args: readonly string[]) => PodmanCommandResult

const PODMAN_CONTAINER_WORKDIR = '/ductum/worktree'
const PODMAN_VERIFY_MARKER = 'DUCTUM_PODMAN_SANDBOX_OK'
const PODMAN_INVOKE_TIMEOUT_MS = 30_000

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

    const hostWorktree = await resolvePodmanWorktree(bundle)
    try {
      assertEnvelopeVerified(bundle.profile, run, image, hostWorktree)
    } catch (error) {
      // The envelope probe is the only step that can fail after the worktree is
      // created; clean it up so it does not leak when the mount/verify fails.
      await removeWorktreeBestEffort(bundle.worktreeManager, hostWorktree)
      throw error
    }

    const reused = (bundle.inheritedWorktreePaths?.length ?? 0) > 0
    return preparedSandbox(bundle.profile, this.id, hostWorktree, [hostWorktree], reused, { ...podmanBoundary })
  }

  teardown(_prepared: PreparedSandbox): void {
    // The verification container is started with --rm and self-removes on exit,
    // so there is nothing to tear down. Kept to satisfy the SandboxDriver contract.
  }
}

async function resolvePodmanWorktree(bundle: SandboxPrepareBundle<ContainerSandboxSpec>): Promise<string> {
  const inherited = bundle.inheritedWorktreePaths ?? []
  if (inherited.length > 0) {
    const path = inherited[0]
    if (path == null || path.trim() === '') {
      throw sandboxError(bundle.profile, 'requires a non-empty inherited worktree path')
    }
    if (!existsSync(path)) {
      throw sandboxError(bundle.profile, `inherited worktree path no longer exists: ${path}`)
    }
    return path
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
  )
  if (worktreePath.trim() === '' || worktreePath === baseWorkingDir) {
    throw sandboxError(bundle.profile, `failed to create a Ductum-managed worktree for ${baseWorkingDir}`)
  }
  return worktreePath
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
 * Prove the isolation envelope is real and enforceable by mounting the worktree
 * into a short-lived container with `--network none` and asserting the mount is
 * present and writable. The container exits immediately (and is `--rm`-removed),
 * so this is a verification, not a kept-alive sandbox.
 */
function assertEnvelopeVerified(
  profile: RunSandboxProfileSnapshot,
  run: (args: readonly string[]) => PodmanCommandResult,
  image: string,
  hostWorktree: string,
): void {
  const verify = run([
    'run', '--rm', '--network', 'none',
    '-v', `${hostWorktree}:${PODMAN_CONTAINER_WORKDIR}`,
    '--', image, 'sh', '-c',
    `test -d ${PODMAN_CONTAINER_WORKDIR} && test -w ${PODMAN_CONTAINER_WORKDIR} && echo ${PODMAN_VERIFY_MARKER}`,
  ])
  if (verify.status !== 0 || !verify.stdout.includes(PODMAN_VERIFY_MARKER)) {
    const detail = verify.stderr.trim() || `exit status ${verify.status ?? 'null'}`
    throw sandboxError(profile, `could not verify the podman sandbox envelope for ${hostWorktree}: ${detail}`)
  }
}

