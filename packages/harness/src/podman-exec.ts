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
  const podmanArgs = [
    'exec',
    '-i',
    '-w', sandbox.podman.workdir,
    ...Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--',
    sandbox.podman.containerId,
    command,
    ...args,
  ]
  return spawn(sandbox.podman.command, podmanArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
}
