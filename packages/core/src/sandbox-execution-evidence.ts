import type { HarnessSession } from './dispatcher-support.js'
import { verifyPodmanSandboxAgentExecution, type VerifiedPodmanAgentExecutionProof } from './podman-sandbox-proof.js'
import type { PodmanInvocation } from './podman-sandbox-driver.js'
import type { PreparedSandboxRuntime } from './sandbox-runtime.js'

export type SandboxAgentExecutionEvidence =
  | { mode: 'host'; hostProcess: true }
  | { mode: 'prepared-container-only'; hostProcess: true; container: PodmanExecutionContainer }
  | { mode: 'agent-contained'; hostProcess: false; container: PodmanExecutionContainer }

interface PodmanExecutionContainer {
  provider: 'podman'
  containerId: string
  workdir: string
  proof?: VerifiedPodmanAgentExecutionProof
}

export function preparedSandboxAgentExecution(sandbox: PreparedSandboxRuntime): SandboxAgentExecutionEvidence {
  if (sandbox.driver === 'host') return { mode: 'host', hostProcess: true }
  return { mode: 'prepared-container-only', hostProcess: true, container: requirePodmanSandbox(sandbox) }
}

export function confirmedSandboxAgentExecution(
  sandbox: PreparedSandboxRuntime,
  session: HarnessSession,
  invocation?: PodmanInvocation,
): SandboxAgentExecutionEvidence {
  if (sandbox.driver === 'host') return { mode: 'host', hostProcess: true }
  const podman = requirePodmanSandbox(sandbox)
  if (
    session.sandboxExecution?.agentProcess !== 'podman-container'
    || session.sandboxExecution.containerId !== podman.containerId
    || session.sandboxExecution.workdir !== podman.workdir
  ) {
    throw new Error('Podman sandbox harness did not confirm agent-contained execution; refusing to report podman while falling back to host')
  }
  return { mode: 'agent-contained', hostProcess: false, container: { ...podman, proof: verifyPodmanSandboxAgentExecution(sandbox, invocation) } }
}

function requirePodmanSandbox(sandbox: PreparedSandboxRuntime): PodmanExecutionContainer {
  const containerId = sandbox.podman?.containerId
  const workdir = sandbox.podman?.workdir
  if (containerId == null || containerId.trim() === '' || workdir == null || workdir.trim() === '') {
    throw new Error('Podman sandbox evidence requires a prepared container id and workdir')
  }
  return { provider: 'podman', containerId, workdir }
}
