import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import {
  createFixture,
  expect,
  describe,
  it,
  seedImplRun,
  vi,
  type Run,
} from './shared.js'
import { buildCheckpointInput } from '../../run-checkpoint.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeWorktreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-startup-reconcile-'))
  tempDirs.push(dir)
  return dir
}

function otherRun(fixture: ReturnType<typeof createFixture>, taskId: Run['taskId'], excludeId: Run['id']): Run {
  return fixture.context.runRepo.list(taskId).find((r) => r.id !== excludeId)!
}

describe('Dispatcher startup reconcile', () => {
  it('resumes expired lease + checkpoint through dispatch with a higher fence', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ seedWorkflowStage, recordEvidence: true })
    const { task, run } = seedImplRun(fixture, 'P2-reconciler', {
      worktree,
      lastHeartbeat: '2026-06-14T11:58:00.000Z',
      heartbeatTimeoutSeconds: 30,
    })
    fixture.context.runCheckpointRepo.upsert(buildCheckpointInput(run, 'implement'))
    const oldLease = fixture.context.attemptLeaseRepo.acquire({
      attemptId: run.id,
      runId: run.id,
      sessionId: run.sessionId,
      ownerProcessId: 'old-owner',
      ttlMs: 1_000,
      now: new Date('2026-06-14T11:58:00.000Z'),
    })

    fixture.nowRef.value = '2026-06-14T12:00:00.000Z'
    const summary = await fixture.dispatcher.reconcileOrphanedSessions()
    const resumed = otherRun(fixture, task.id, run.id)

    expect(summary.resumable).toEqual([run.id])
    expect(summary.resumed).toEqual([{ fromRunId: run.id, toRunId: resumed.id }])
    expect(fixture.context.runRepo.get(run.id)?.terminalState).toBe('stalled')
    expect(resumed.stage).toBe('implement')
    expect(resumed.worktreePaths).toEqual([worktree])
    expect(seedWorkflowStage).toHaveBeenCalledWith(resumed.id, 'implement')
    expect(fixture.context.attemptLeaseRepo.getLatestForRun(resumed.id)?.fenceToken).toBeGreaterThan(oldLease.fenceToken)
    expect(fixture.context.evidenceRepo.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'startup_reconcile',
      disposition: 'resumable',
    })
  })
})
