import { describe, expect, it, vi } from 'vitest'

import {
  reconcileOrphanedSessions,
  STARTUP_DEAD_CLAIM_REASON,
  STARTUP_NO_MAPPING_REASON,
  STARTUP_STALLED_REASON,
} from '../dispatcher-reconcile.js'
import type { AttemptLease } from '../attempt-lease.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
import type { Agent, Run, RunId } from '../types.js'
import { fixture, harness, makeMapping, makeRun, makeTask } from './dispatcher-reconcile-fixture.js'

describe('reconcileOrphanedSessions classification', () => {
  it('stalls missing session mappings as no-mapping with visible audit data', async () => {
    const fx = fixture({ runs: [makeRun('r1')], mappings: [] })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.noMapping).toEqual(['r1'])
    expect(summary.dispositions[0]).toMatchObject({ runId: 'r1', disposition: 'no-mapping', action: 'stall' })
    expect(fx.stateMachine.markStalled).toHaveBeenCalledWith('r1')
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', STARTUP_NO_MAPPING_REASON, true)
    expect(fx.evidence[0]?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'startup_reconcile',
      disposition: 'no-mapping',
      counts: { scanned: 1, alreadyLive: 0, noMapping: 1, stalled: 1 },
    })
  })

  it('classifies expired lease claims without checkpoints as dead-claim', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      leases: [lease('r1', 'active', '2026-06-14T11:59:00.000Z')],
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.deadClaim).toEqual(['r1'])
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', STARTUP_DEAD_CLAIM_REASON, true)
    expect(fx.attemptLeaseRepo.expireRun).toHaveBeenCalledWith('r1', new Date('2026-06-14T12:00:00.000Z'))
  })

  it('classifies non-leased active runs without checkpoints as genuinely-stalled', async () => {
    const fx = fixture({ runs: [makeRun('r1')], mappings: [makeMapping('r1')] })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.genuinelyStalled).toEqual(['r1'])
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', STARTUP_STALLED_REASON, true)
    expect(fx.sessionMappingRepo.delete).toHaveBeenCalledWith('sess-r1')
  })

  it('does not stall or resume a run with a valid active lease', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      leases: [lease('r1', 'active', '2026-06-14T12:05:00.000Z')],
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.alreadyLive).toBe(1)
    expect(summary.dispositions[0]).toMatchObject({ disposition: 'already-live', action: 'none' })
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
    expect(fx.resumeRun).not.toHaveBeenCalled()
  })

  it('does not stall workflow-owned approval or downstream-review runs', async () => {
    const ship = makeRun('r1', 'agent-1', { stage: 'ship', pendingApproval: true })
    const downstream = makeRun('r2')
    const fx = fixture({
      runs: [ship, downstream],
      mappings: [makeMapping('r1'), makeMapping('r2')],
      tasks: [
        makeTask('task-1', 'P1', { status: 'active' }),
        makeTask('task-review', 'review-P1', { requiredRole: 'reviewer', status: 'ready' }),
      ],
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.alreadyLive).toBe(2)
    expect(summary.stalled).toEqual([])
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
  })

  it('dry-run returns dispositions without writing state or evidence', async () => {
    const fx = fixture({ runs: [makeRun('r1')], mappings: [], dryRun: true })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.dryRun).toBe(true)
    expect(summary.noMapping).toEqual(['r1'])
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
    expect(fx.evidence).toEqual([])
  })

  it('keeps an in-process active session live when no lease repo is wired', async () => {
    const active = new Map<RunId, ActiveDispatchSession>()
    active.set('r1' as RunId, {
      agentId: 'a' as Run['agentId'],
      agent: {} as Agent,
      adapter: harness(),
      session: { sessionId: 'live', runId: 'r1' as RunId, waitForCompletion: vi.fn() },
      mcpServer: {},
      released: false,
    })
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      active,
    })
    ;(fx as { attemptLeaseRepo?: unknown }).attemptLeaseRepo = undefined

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.alreadyLive).toBe(1)
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
  })
})

function lease(
  runId: string,
  status: AttemptLease['status'],
  expiresAt: string,
): AttemptLease {
  return {
    attemptId: runId,
    runId: runId as RunId,
    sessionId: `sess-${runId}`,
    ownerProcessId: 'old-owner',
    fenceToken: 1,
    status,
    expiresAt,
    renewedAt: '2026-06-14T11:58:00.000Z',
    releasedAt: null,
    createdAt: '2026-06-14T11:58:00.000Z',
    updatedAt: '2026-06-14T11:58:00.000Z',
  }
}
