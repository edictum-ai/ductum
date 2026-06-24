import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'

export interface HostProcessTreeOwnership {
  kind: 'process-group' | 'direct-child'
  pid: number | null
  unsupportedReason?: string
}

export interface HostProcessLaunch {
  child: ChildProcessWithoutNullStreams
  ownership: HostProcessTreeOwnership
}

export interface ProcessTreeKillResult {
  escalated: boolean
  exited: boolean
  ownership: HostProcessTreeOwnership
}

interface KillTarget {
  pid: number | null | undefined
  exitCode?: number | null
  signalCode?: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: () => void): void
  removeListener(event: 'exit', listener: () => void): void
}

interface TerminateProcessTreeOptions {
  gracePeriodMs?: number
  forceKillWaitMs?: number
  sendSignal?: (pid: number, signal: NodeJS.Signals | number) => void
}

const DEFAULT_GRACE_PERIOD_MS = 250

export function spawnHostExternalCliProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
): HostProcessLaunch {
  const ownership = ownershipForPlatform(process.platform)
  const child = spawn(command, [...args], {
    ...options,
    detached: ownership.kind === 'process-group',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return { child, ownership: { ...ownership, pid: child.pid ?? null } }
}

export function ownershipForPlatform(platform: NodeJS.Platform): HostProcessTreeOwnership {
  if (platform === 'win32') {
    return {
      kind: 'direct-child',
      pid: null,
      unsupportedReason: 'detached process-group cleanup is unsupported on win32',
    }
  }
  return { kind: 'process-group', pid: null }
}

export async function terminateProcessTree(
  child: KillTarget,
  ownership: HostProcessTreeOwnership,
  options: TerminateProcessTreeOptions = {},
): Promise<ProcessTreeKillResult> {
  if (child.exitCode != null || child.signalCode != null) {
    return { escalated: false, exited: true, ownership }
  }

  const sendSignal = options.sendSignal ?? process.kill
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
  const forceKillWaitMs = options.forceKillWaitMs ?? gracePeriodMs

  sendOwnedSignal(child, ownership, 'SIGTERM', sendSignal)
  if (await waitForExit(child, gracePeriodMs)) {
    return { escalated: false, exited: true, ownership }
  }

  sendOwnedSignal(child, ownership, 'SIGKILL', sendSignal)
  return {
    escalated: true,
    exited: await waitForExit(child, forceKillWaitMs),
    ownership,
  }
}

function sendOwnedSignal(
  child: Pick<KillTarget, 'pid' | 'kill'>,
  ownership: HostProcessTreeOwnership,
  signal: NodeJS.Signals | number,
  sendSignal: (pid: number, signal: NodeJS.Signals | number) => void,
): void {
  const pid = ownership.pid ?? child.pid ?? null
  if (pid == null) {
    try { child.kill(signal) } catch { /* ignore */ }
    return
  }
  if (ownership.kind === 'process-group') {
    try {
      sendSignal(-pid, signal)
      return
    } catch {
      // Fall back to the direct child when group killing is unavailable.
    }
  }
  try {
    sendSignal(pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* ignore */ }
  }
}

function waitForExit(child: KillTarget, timeoutMs: number): Promise<boolean> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
    child.once('exit', onExit)

    function finish(exited: boolean): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve(exited)
    }
  })
}

export function asKillTarget(child: ChildProcess): KillTarget {
  return child as KillTarget
}
