import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SessionRunMapping } from './types.js'

const SIGNAL_WAIT_MS = 250
const START_TIME_TOLERANCE_MS = 5_000
const execFileAsync = promisify(execFile)

export interface OrphanWorkerCleanupResult {
  attempted: boolean
  outcome: 'cleaned' | 'skipped' | 'failed'
  reason: string
  pid: number | null
  ownershipKind: Exclude<SessionRunMapping['workerOwnershipKind'], undefined>
  startedAt: string | null
  escalated?: boolean
  exited?: boolean
}

export async function cleanupOrphanWorkerProcess(
  mapping: Pick<
    SessionRunMapping,
    'workerPid' | 'workerOwnershipKind' | 'workerStartedAt' | 'workerOwnershipUnsupportedReason' | 'createdAt'
  >,
): Promise<OrphanWorkerCleanupResult> {
  const pid = normalizePid(mapping.workerPid)
  const ownershipKind = mapping.workerOwnershipKind ?? null
  const startedAt = mapping.workerStartedAt ?? null

  if (pid == null || ownershipKind == null) {
    return skipped('worker ownership metadata missing', pid, ownershipKind, startedAt)
  }
  if (mapping.workerOwnershipUnsupportedReason != null && mapping.workerOwnershipUnsupportedReason.trim() !== '') {
    return skipped(mapping.workerOwnershipUnsupportedReason.trim(), pid, ownershipKind, startedAt)
  }
  if (startedAt == null || startedAt.trim() === '') {
    return skipped('worker start-time metadata missing', pid, ownershipKind, startedAt)
  }
  if (!(await isProcessAlive(pid))) {
    return skipped('worker process already exited', pid, ownershipKind, startedAt)
  }

  const liveStartedAtMs = await readProcessStartedAtMs(pid)
  if (liveStartedAtMs == null) {
    return skipped('worker live start-time unavailable; refusing to kill unverified process', pid, ownershipKind, startedAt)
  }

  if (!matchesStartedAt(startedAt, liveStartedAtMs)) {
    return skipped('worker start-time mismatch; refusing to kill unrelated process', pid, ownershipKind, startedAt)
  }

  try {
    sendOwnedSignal(pid, ownershipKind, 'SIGTERM')
    if (await waitForExit(pid, SIGNAL_WAIT_MS)) {
      return cleaned(pid, ownershipKind, startedAt, false, true)
    }
    sendOwnedSignal(pid, ownershipKind, 'SIGKILL')
    return cleaned(pid, ownershipKind, startedAt, true, await waitForExit(pid, SIGNAL_WAIT_MS))
  } catch (error) {
    return {
      attempted: true,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      pid,
      ownershipKind,
      startedAt,
    }
  }
}

function normalizePid(value: number | null | undefined): number | null {
  return Number.isInteger(value) && value != null && value > 1 ? value : null
}

function skipped(
  reason: string,
  pid: number | null,
  ownershipKind: SessionRunMapping['workerOwnershipKind'],
  startedAt: string | null,
): OrphanWorkerCleanupResult {
  return { attempted: false, outcome: 'skipped', reason, pid, ownershipKind: ownershipKind ?? null, startedAt }
}

function cleaned(
  pid: number,
  ownershipKind: NonNullable<SessionRunMapping['workerOwnershipKind']>,
  startedAt: string,
  escalated: boolean,
  exited: boolean,
): OrphanWorkerCleanupResult {
  return {
    attempted: true,
    outcome: 'cleaned',
    reason: exited ? 'worker process terminated' : 'worker signal sent but exit was not observed',
    pid,
    ownershipKind,
    startedAt,
    escalated,
    exited,
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isMissingProcessError(error)
  }
}

function sendOwnedSignal(
  pid: number,
  ownershipKind: NonNullable<SessionRunMapping['workerOwnershipKind']>,
  signal: NodeJS.Signals,
): void {
  process.kill(ownershipKind === 'process-group' ? -pid : pid, signal)
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (Date.now() <= deadline) {
    if (!(await isProcessAlive(pid))) return true
    await delay(10)
  }
  return !(await isProcessAlive(pid))
}

async function readProcessStartedAtMs(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 1_000 })
    const parsed = Date.parse(stdout.trim())
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function matchesStartedAt(expected: string, actualMs: number): boolean {
  const expectedMs = Date.parse(expected)
  return Number.isFinite(expectedMs)
    && Math.abs(expectedMs - actualMs) <= START_TIME_TOLERANCE_MS
}

function isMissingProcessError(error: unknown): boolean {
  return error != null
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'ESRCH'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
