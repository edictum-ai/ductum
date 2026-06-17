import {
  HostSandboxDriver,
  assertSupportedHostSandboxRuntime,
  parseSandboxSpec,
  type PreparedSandbox,
  type SandboxPrepareBundle,
  type SandboxSpec,
} from './sandbox-driver.js'
import type { RunSandboxProfileSnapshot } from './types.js'

export type PreparedSandboxRuntime = PreparedSandbox

export interface SandboxRuntimePrepareInput extends Omit<SandboxPrepareBundle<SandboxSpec>, 'spec'> {
  resourceSpec: unknown
}

const HOST_SANDBOX_DRIVER = new HostSandboxDriver()

export function assertSupportedSandboxRuntime(input: SandboxRuntimePrepareInput): void {
  const spec = parseSandboxSpec(input.profile, input.resourceSpec)
  assertSupportedHostSandboxRuntime({ ...input, spec })
}

export function assertSupportedSandboxProfileSpec(
  profile: RunSandboxProfileSnapshot,
  spec: unknown,
): void {
  parseSandboxSpec(profile, spec)
}

export async function prepareSandboxRuntime(input: SandboxRuntimePrepareInput): Promise<PreparedSandboxRuntime> {
  const spec = parseSandboxSpec(input.profile, input.resourceSpec)
  return HOST_SANDBOX_DRIVER.prepare({ ...input, spec })
}
