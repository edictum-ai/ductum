import { spawn } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { reconcileOrphanedSessions } from '../dispatcher-reconcile.js'
import type { RunId } from '../types.js'
import { fixture, makeMapping, makeRun } from './dispatcher-reconcile-fixture.js'

const spawnedPids = new Set<number>()

afterEach(async () => {
  for (const pid of [...spawnedPids]) {
    try { process.kill(-pid, 'SIGKILL') } catch {}
    try { process.kill(pid, 'SIGKILL') } catch {}
    spawnedPids.delete(pid)
  }
})

describe('reconcileOrphanedSessions worker cleanup', () => {
  it('reaps a stale ductum-owned worker and leaves no active attempt behind after startup reconcile', async () => {
    if (process.platform === 'win32') return
    const workerPid = spawnDetachedWorker()
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1', 'codex-app-server', {
        workerPid,
        workerOwnershipKind: 'process-group',
        workerStartedAt: new Date().toISOString(),
      })],
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.stalled).toEqual(['r1'])
    expect(summary.cleanup).toMatchObject({ attempted: 1, cleaned: 1, failed: 0 })
    expect(summary.dispositions[0]?.workerCleanup).toMatchObject({ outcome: 'cleaned', pid: workerPid })
    await waitForExit(workerPid)
    expect(isProcessAlive(workerPid)).toBe(false)
    expect(fx.runRepo.getActive()).toEqual([])
  })

  it('skips cleanup when persisted worker metadata does not match the live process start time', async () => {
    if (process.platform === 'win32') return
    const workerPid = spawnDetachedWorker()
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1', 'codex-app-server', {
        workerPid,
        workerOwnershipKind: 'process-group',
        workerStartedAt: '2000-01-01T00:00:00.000Z',
      })],
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.cleanup).toMatchObject({ attempted: 0, cleaned: 0, skipped: 1, failed: 0 })
    expect(summary.dispositions[0]?.workerCleanup).toMatchObject({
      outcome: 'skipped',
      reason: 'worker start-time mismatch; refusing to kill unrelated process',
      pid: workerPid,
    })
    expect(isProcessAlive(workerPid)).toBe(true)
  })

  it('records cleanup failures in evidence and operator-visible updates instead of claiming success', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
    })
    const runUpdateRepo = { create: vi.fn() }

    const summary = await reconcileOrphanedSessions({
      ...fx,
      runUpdateRepo: runUpdateRepo as never,
      cleanupWorkerProcess: async (_run, entry) => ({
        attempted: true,
        outcome: 'failed',
        reason: 'simulated cleanup failure',
        pid: entry.mapping?.workerPid ?? 123,
        ownershipKind: entry.mapping?.workerOwnershipKind ?? 'process-group',
        startedAt: entry.mapping?.workerStartedAt ?? '2026-06-14T12:00:00.000Z',
      }),
    })

    expect(summary.cleanup).toMatchObject({ attempted: 1, cleaned: 0, failed: 1 })
    expect(summary.dispositions[0]?.workerCleanup).toMatchObject({
      outcome: 'failed',
      reason: 'simulated cleanup failure',
    })
    expect(runUpdateRepo.create).toHaveBeenCalledWith('r1', 'startup reconcile worker cleanup failed: simulated cleanup failure')
    expect(fx.evidence[0]?.payload).toMatchObject({
      counts: { cleanupAttempted: 1, cleanupCleaned: 0, cleanupFailed: 1 },
      dispositions: [expect.objectContaining({
        runId: 'r1' as RunId,
        workerCleanup: expect.objectContaining({ outcome: 'failed', reason: 'simulated cleanup failure' }),
      })],
    })
  })
})

function spawnDetachedWorker(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  })
  const pid = child.pid
  if (pid == null) throw new Error('failed to spawn detached worker')
  spawnedPids.add(pid)
  child.unref()
  return pid
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      spawnedPids.delete(pid)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for process ${pid} to exit`)
}
