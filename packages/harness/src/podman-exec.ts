import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import type { PreparedSandboxRuntime } from '@ductum/core'

export function spawnInPodmanSandbox(
  sandbox: PreparedSandboxRuntime,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  if (sandbox.driver !== 'container' || sandbox.podman == null) {
    throw new Error('Podman sandbox execution requires a prepared podman container')
  }
  const proof = sandbox.podman.proof
  const execCommand = proof == null
    ? [command, ...args]
    : ['sh', '-lc', buildProofWrappedCommand(sandbox, command, args)]
  const podmanArgs = [
    'exec',
    '-i',
    '-w', sandbox.podman.workdir,
    ...Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--',
    sandbox.podman.containerId,
    ...execCommand,
  ]
  return spawn(sandbox.podman.command, podmanArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function buildProofWrappedCommand(
  sandbox: PreparedSandboxRuntime,
  command: string,
  args: readonly string[],
): string {
  const proof = sandbox.podman?.proof
  if (proof == null) throw new Error('Podman sandbox execution requires launch proof metadata')
  const payload = JSON.stringify({
    kind: 'ductum-podman-agent-launch-proof',
    runId: sandbox.podman?.runId,
    containerId: sandbox.podman?.containerId,
    workdir: sandbox.podman?.workdir,
    nonce: proof.nonce,
  })
  return `printf '%s' ${shellQuote(payload)} > ${shellQuote(proof.filePath)} && exec ${[command, ...args].map(shellQuote).join(' ')}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}
