import { spawnSync } from 'node:child_process'

import type { PreparedSandboxRuntime } from './sandbox-runtime.js'
import type { PodmanInvocation } from './podman-sandbox-driver.js'

const PODMAN_AGENT_PROOF_KIND = 'ductum-podman-agent-launch-proof'
const PODMAN_INVOKE_TIMEOUT_MS = 30_000

export interface VerifiedPodmanAgentExecutionProof {
  kind: typeof PODMAN_AGENT_PROOF_KIND
  runId: string
  hostWorktree: string
  markerFile: string
  nonce: string
  verifiedBy: 'podman-inspect+exec'
}

export function verifyPodmanSandboxAgentExecution(
  sandbox: PreparedSandboxRuntime,
  invocation?: PodmanInvocation,
): VerifiedPodmanAgentExecutionProof {
  const podman = requirePodmanProofContext(sandbox)
  const run = invocation ?? podmanInvocationForCommand(podman.command)
  const labels = inspectContainerLabels(podman.containerId, run)
  assertEqual(labels.sandbox, 'podman', 'podman inspect sandbox label')
  assertEqual(labels.runId, podman.runId, 'podman inspect run label')
  assertEqual(labels.hostWorktree, sandbox.workingDir, 'podman inspect host worktree label')
  assertEqual(labels.runtimeDir, podman.runtimeHostDir, 'podman inspect runtime-dir label')
  assertEqual(labels.proofFile, podman.proof.filePath, 'podman inspect proof-file label')
  assertEqual(labels.proofNonce, podman.proof.nonce, 'podman inspect proof nonce')
  assertEqual(labels.workdir, podman.workdir, 'podman inspect workingDir')
  assertMounts(podman.containerId, sandbox.workingDir, podman.workdir, podman.runtimeHostDir, podman.runtimeDir, run)
  const proof = readAgentProof(podman.containerId, podman.workdir, podman.proof.filePath, run)
  assertEqual(proof.kind, PODMAN_AGENT_PROOF_KIND, 'podman proof kind')
  assertEqual(proof.runId, podman.runId, 'podman proof runId')
  assertEqual(proof.containerId, podman.containerId, 'podman proof containerId')
  assertEqual(proof.workdir, podman.workdir, 'podman proof workdir')
  assertEqual(proof.nonce, podman.proof.nonce, 'podman proof nonce')
  return {
    kind: PODMAN_AGENT_PROOF_KIND,
    runId: podman.runId,
    hostWorktree: sandbox.workingDir,
    markerFile: podman.proof.filePath,
    nonce: podman.proof.nonce,
    verifiedBy: 'podman-inspect+exec',
  }
}

function requirePodmanProofContext(sandbox: PreparedSandboxRuntime) {
  if (sandbox.driver !== 'container' || sandbox.podman == null) {
    throw new Error('Podman verification requires a prepared podman sandbox')
  }
  const { containerId, runId, command, workdir, runtimeDir, runtimeHostDir, proof } = sandbox.podman
  if ([containerId, runId, command, workdir, runtimeDir, runtimeHostDir, proof?.filePath, proof?.nonce].some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('Podman verification requires prepared container identity, runtime mounts, and proof metadata')
  }
  return {
    containerId,
    runId,
    command,
    workdir,
    runtimeDir: runtimeDir as string,
    runtimeHostDir: runtimeHostDir as string,
    proof: proof as { filePath: string; nonce: string },
  }
}

function podmanInvocationForCommand(command: string): PodmanInvocation {
  return (args) => {
    const result = spawnSync(command, [...args], {
      encoding: 'utf8',
      timeout: PODMAN_INVOKE_TIMEOUT_MS,
    })
    return {
      status: result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    }
  }
}

function inspectContainerLabels(containerId: string, invocation: PodmanInvocation) {
  const result = invocation([
    'inspect',
    '--format',
    '{{ index .Config.Labels "ductum.sandbox" }}\n{{ index .Config.Labels "ductum.run" }}\n{{ index .Config.Labels "ductum.hostWorktree" }}\n{{ index .Config.Labels "ductum.runtimeDir" }}\n{{ index .Config.Labels "ductum.proofFile" }}\n{{ index .Config.Labels "ductum.proofNonce" }}\n{{ .Config.WorkingDir }}',
    '--',
    containerId,
  ])
  if (result.status !== 0) {
    throw new Error(`Independent podman proof failed: podman inspect could not read container ${containerId}: ${result.stderr.trim() || `exit status ${result.status ?? 'null'}`}`)
  }
  const [sandbox, runId, hostWorktree, runtimeDir, proofFile, proofNonce, workdir] = result.stdout.replace(/\n$/, '').split('\n')
  return { sandbox, runId, hostWorktree, runtimeDir, proofFile, proofNonce, workdir }
}

function assertMounts(
  containerId: string,
  hostWorktree: string,
  workdir: string,
  runtimeHostDir: string,
  runtimeDir: string,
  invocation: PodmanInvocation,
): void {
  const result = invocation(['inspect', '--format', '{{ range .Mounts }}{{ .Source }}|{{ .Destination }}|{{ .RW }}\n{{ end }}', '--', containerId])
  if (result.status !== 0) {
    throw new Error(`Independent podman proof failed: podman inspect could not read mounts for ${containerId}: ${result.stderr.trim() || `exit status ${result.status ?? 'null'}`}`)
  }
  const mounts = result.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [source, destination, rw] = line.split('|')
    return { source: source ?? '', destination: destination ?? '', rw }
  })
  assertHasMount(mounts, hostWorktree, workdir)
  assertHasMount(mounts, runtimeHostDir, runtimeDir)
}

function assertHasMount(
  mounts: Array<{ source: string; destination: string; rw: string | undefined }>,
  source: string,
  destination: string,
): void {
  const found = mounts.some((mount) => mount.source === source && mount.destination === destination && mount.rw === 'true')
  if (!found) throw new Error(`Independent podman proof failed: expected rw mount ${source} -> ${destination}`)
}

function readAgentProof(containerId: string, workdir: string, proofFile: string, invocation: PodmanInvocation): Record<string, string> {
  const result = invocation(['exec', '-w', workdir, '--', containerId, 'sh', '-c', `cat ${shellQuote(proofFile)}`])
  if (result.status !== 0 || result.stdout.trim() === '') {
    throw new Error(`Independent podman proof failed: agent launch proof missing in container ${containerId}`)
  }
  try {
    return JSON.parse(result.stdout) as Record<string, string>
  } catch {
    throw new Error(`Independent podman proof failed: agent launch proof in container ${containerId} was not valid JSON`)
  }
}

function assertEqual(actual: string | undefined, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`Independent podman proof failed: ${label} mismatch (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? '')})`)
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}
