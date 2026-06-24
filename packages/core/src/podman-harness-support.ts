import { AgentRuntimeResolutionError, type AgentRuntimeResolution } from './agent-runtime-resolution.js'
import type { Agent } from './types.js'

export function assertPodmanHarnessSupportsContainer(
  runtime: AgentRuntimeResolution<Agent>,
  runtimeAgent: Agent,
): void {
  if (runtime.sandboxProfile?.provider !== 'podman' || runtime.sandboxProfile.mode !== 'container') return
  const supportedSandboxes = runtime.harnessSnapshot?.spec.supportedSandboxes
  if (!Array.isArray(supportedSandboxes) || !supportedSandboxes.includes('container')) {
    throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} harness ${runtimeAgent.harness} does not declare container sandbox support`, 'unsupported_harness')
  }
  if (runtimeAgent.harness === 'codex-sdk' || runtimeAgent.harness === 'codex-app-server') return
  throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} harness ${runtimeAgent.harness} does not support podman/container sandbox execution`, 'unsupported_harness')
}
