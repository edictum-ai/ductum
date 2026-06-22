import { AgentRuntimeResolutionError, type AgentRuntimeResolution } from './agent-runtime-resolution.js'
import type { Agent } from './types.js'

export function assertPodmanHarnessSupportsContainer(
  runtime: AgentRuntimeResolution<Agent>,
  runtimeAgent: Agent,
): void {
  if (runtime.sandboxProfile?.provider !== 'podman' || runtime.sandboxProfile.mode !== 'container') return
  if (runtimeAgent.harness === 'codex-sdk' || runtimeAgent.harness === 'codex-app-server') return
  throw new AgentRuntimeResolutionError(`Agent ${runtimeAgent.name} harness ${runtimeAgent.harness} does not support podman/container sandbox execution`, 'unsupported_harness')
}
