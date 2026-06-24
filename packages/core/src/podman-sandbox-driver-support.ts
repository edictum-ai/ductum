import { rmSync } from 'node:fs'

import { defaultPodmanInvocation, type PodmanCommandResult, type PodmanInvocation } from './podman-sandbox-driver.js'

export interface PodmanCleanupResult {
  removed: string[]
  failed: Array<{ containerId: string; message: string }>
  listFailed: string[]
}

export function cleanupPodmanContainersForRuns(runIds: Iterable<string>, invocation: PodmanInvocation = defaultPodmanInvocation): PodmanCleanupResult {
  const result: PodmanCleanupResult = { removed: [], failed: [], listFailed: [] }
  for (const runId of runIds) {
    const list = invocation(['ps', '-a', '--filter', 'label=ductum.sandbox=podman', '--filter', `label=ductum.run=${runId}`, '--format', '{{.ID}}'])
    if (list.status !== 0) {
      result.listFailed.push(runId)
      continue
    }
    for (const containerId of list.stdout.trim().split(/\s+/).filter(Boolean)) {
      const runtimeDir = runtimeDirForContainer(containerId, invocation)
      const removed = invocation(['rm', '-f', '--', containerId])
      if (removed.status !== 0) {
        result.failed.push({ containerId, message: podmanFailureDetail(removed) })
        continue
      }
      result.removed.push(containerId)
      if (runtimeDir != null) removeRuntimeDirBestEffort(runtimeDir)
    }
  }
  return result
}

export function runtimeDirForContainer(containerId: string, invocation: PodmanInvocation): string | null {
  const inspect = invocation(['inspect', '--format', '{{ index .Config.Labels "ductum.runtimeDir" }}', '--', containerId])
  if (inspect.status !== 0) return null
  const value = inspect.stdout.trim()
  return value === '' || value === '<no value>' ? null : value
}

export function podmanFailureDetail(result: PodmanCommandResult): string {
  return result.stderr.trim() || `exit status ${result.status ?? 'null'}`
}

export function removeRuntimeDirBestEffort(runtimeHostDir: string): void {
  try {
    rmSync(runtimeHostDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup only.
  }
}
