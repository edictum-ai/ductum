import {
  HostSandboxDriver,
  assertSupportedHostSandboxRuntime,
  parseSandboxSpec,
  type PreparedSandbox,
  type SandboxPrepareBundle,
  type SandboxSpec,
} from './sandbox-driver.js'
import { PodmanSandboxDriver } from './podman-sandbox-driver.js'
import type { RunSandboxProfileSnapshot } from './types.js'

export type PreparedSandboxRuntime = PreparedSandbox

export interface SandboxRuntimePrepareInput extends Omit<SandboxPrepareBundle<SandboxSpec>, 'spec'> {
  resourceSpec: unknown
}

const HOST_SANDBOX_DRIVER = new HostSandboxDriver()
const PODMAN_SANDBOX_DRIVER = new PodmanSandboxDriver()

export function assertSupportedSandboxRuntime(input: SandboxRuntimePrepareInput): void {
  const spec = parseSandboxSpec(input.profile, input.resourceSpec)
  if (spec.kind === 'host') {
    assertSupportedHostSandboxRuntime({ ...input, spec })
    return
  }
  if (spec.kind === 'container' && spec.provider === 'podman') {
    // Claim validation already happened in parseSandboxSpec. Podman, engine,
    // and image availability are runtime concerns, verified (fail-closed) when
    // the sandbox is prepared rather than before the run record is created.
    return
  }
  throw unsupportedSandboxSpec(spec)
}

export function assertSupportedSandboxProfileSpec(
  profile: RunSandboxProfileSnapshot,
  spec: unknown,
): void {
  parseSandboxSpec(profile, spec)
}

export async function prepareSandboxRuntime(input: SandboxRuntimePrepareInput): Promise<PreparedSandboxRuntime> {
  const spec = parseSandboxSpec(input.profile, input.resourceSpec)
  if (spec.kind === 'host') {
    return HOST_SANDBOX_DRIVER.prepare({ ...input, spec })
  }
  if (spec.kind === 'container' && spec.provider === 'podman') {
    return PODMAN_SANDBOX_DRIVER.prepare({ ...input, spec })
  }
  throw unsupportedSandboxSpec(spec)
}

export async function teardownSandboxRuntime(prepared: PreparedSandboxRuntime | undefined): Promise<void> {
  if (prepared == null) return
  if (prepared.driver === 'host') {
    await HOST_SANDBOX_DRIVER.teardown()
    return
  }
  if (prepared.driver === 'container' && prepared.profile.provider === 'podman') {
    await PODMAN_SANDBOX_DRIVER.teardown(prepared)
  }
}

function unsupportedSandboxSpec(spec: SandboxSpec): Error {
  return new Error(`Unsupported sandbox driver: ${spec.provider}/${spec.mode}`)
}
