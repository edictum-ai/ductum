import { describe, expect, it, vi } from 'vitest'

import {
  reconcileOrphanedSessions,
  STARTUP_DEAD_CLAIM_REASON,
  STARTUP_NO_MAPPING_REASON,
  STARTUP_STALLED_REASON,
} from '../dispatcher-reconcile.js'
import type { AttemptLease } from '../attempt-lease.js'
import { DUCTUM_RUNTIME_EVIDENCE_PRODUCER, withTrustedEvidenceProducer } from '../evidence-provenance.js'
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

  it('routes stored completion summaries instead of treating old leases as live', async () => {
    const events: string[] = []
    const cleanupWorkerProcess = vi.fn(async () => {
      events.push('cleanup')
      return {
        attempted: false,
        outcome: 'skipped' as const,
        reason: 'worker metadata unavailable',
        pid: null,
        ownershipKind: null,
        startedAt: null,
      }
    })
    const routeStoredCompletion = vi.fn().mockResolvedValue(undefined)
    routeStoredCompletion.mockImplementation(async () => { events.push('route') })
    const fx = fixture({
      runs: [makeRun('r1', 'agent-1', { completionSummary: 'implementation completed before restart' })],
      mappings: [makeMapping('r1')],
      leases: [lease('r1', 'active', '2026-06-14T12:05:00.000Z')],
    })

    const summary = await reconcileOrphanedSessions({ ...fx, cleanupWorkerProcess, routeStoredCompletion })

    expect(summary.completedButUnrecorded).toEqual(['r1'])
    expect(summary.dispositions[0]).toMatchObject({ disposition: 'completed-but-unrecorded', action: 'finalize' })
    expect(summary.cleanup).toMatchObject({ attempted: 0, skipped: 1, failed: 0 })
    expect(summary.dispositions[0]?.workerCleanup).toMatchObject({ outcome: 'skipped' })
    expect(cleanupWorkerProcess).toHaveBeenCalledTimes(1)
    expect(routeStoredCompletion).toHaveBeenCalledWith('r1')
    expect(events).toEqual(['cleanup', 'route'])
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
    expect(fx.resumeRun).not.toHaveBeenCalled()
  })

  it('routes trusted completion markers even when no completion summary was stored', async () => {
    const routeStoredCompletion = vi.fn().mockResolvedValue(undefined)
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      leases: [lease('r1', 'active', '2026-06-14T12:05:00.000Z')],
    })
    fx.evidenceRepo.create({
      id: 'ev-agent-complete' as never,
      runId: 'r1' as RunId,
      type: 'custom',
      payload: withTrustedEvidenceProducer({
        kind: 'agent.complete',
        summary: '',
        recordedAt: '2026-06-14T11:59:00.000Z',
      }, DUCTUM_RUNTIME_EVIDENCE_PRODUCER),
    })

    const summary = await reconcileOrphanedSessions({ ...fx, routeStoredCompletion })

    expect(summary.completedButUnrecorded).toEqual(['r1'])
    expect(summary.dispositions[0]).toMatchObject({ disposition: 'completed-but-unrecorded', action: 'finalize' })
    expect(routeStoredCompletion).toHaveBeenCalledWith('r1')
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
  })

  it('treats a fresh heartbeat during an in-flight tool call as live even without an active lease', async () => {
    const fx = fixture({
      runs: [makeRun('r1', 'agent-1', {
        lastHeartbeat: '2026-06-14T11:59:30.000Z',
        heartbeatTimeoutSeconds: 120,
      })],
      mappings: [makeMapping('r1')],
      leases: [lease('r1', 'expired', '2026-06-14T11:58:00.000Z')],
      activity: {
        r1: [{
          id: 1,
          runId: 'r1' as RunId,
          kind: 'tool_call',
          content: 'node scripts/build-homebrew-artifact.mjs 2>&1 | tail -40',
          toolName: 'Bash',
          createdAt: '2026-06-14T11:59:00.000Z',
        }],
      },
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.alreadyLive).toBe(1)
    expect(summary.stalled).toEqual([])
    expect(summary.dispositions[0]).toMatchObject({
      disposition: 'already-live',
      action: 'none',
      inFlightTool: 'in-flight Bash: node scripts/build-homebrew-artifact.mjs 2>&1 | tail -40',
    })
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
  })

  it('does not stall workflow-owned approval or downstream-review runs', async () => {
    const routeStoredCompletion = vi.fn().mockResolvedValue(undefined)
    const ship = makeRun('r1', 'agent-1', { stage: 'ship', pendingApproval: true, completionSummary: 'already shipped' })
    const downstream = makeRun('r2', 'agent-1', { completionSummary: 'review already queued' })
    const fx = fixture({
      runs: [ship, downstream],
      mappings: [makeMapping('r1'), makeMapping('r2')],
      tasks: [
        makeTask('task-1', 'P1', { status: 'active' }),
        makeTask('task-review', 'review-P1', { requiredRole: 'reviewer', status: 'ready' }),
      ],
    })

    const summary = await reconcileOrphanedSessions({ ...fx, routeStoredCompletion })

    expect(summary.alreadyLive).toBe(2)
    expect(summary.stalled).toEqual([])
    expect(summary.completedButUnrecorded).toEqual([])
    expect(routeStoredCompletion).not.toHaveBeenCalled()
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

  it('surfaces the last in-flight tool on a genuinely stalled recovery path', async () => {
    const fx = fixture({
      runs: [makeRun('r1', 'agent-1', {
        lastHeartbeat: '2026-06-14T11:50:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })],
      mappings: [makeMapping('r1')],
      activity: {
        r1: [{
          id: 1,
          runId: 'r1' as RunId,
          kind: 'tool_call',
          content: 'node scripts/build-homebrew-artifact.mjs 2>&1 | tail -40',
          toolName: 'Bash',
          createdAt: '2026-06-14T11:51:00.000Z',
        }],
      },
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.genuinelyStalled).toEqual(['r1'])
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith(
      'r1',
      'startup reconcile found no live lease or resumable checkpoint; last in-flight Bash: node scripts/build-homebrew-artifact.mjs 2>&1 | tail -40',
      true,
    )
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
