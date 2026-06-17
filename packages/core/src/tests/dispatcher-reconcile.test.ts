import { describe, expect, it, vi } from 'vitest'

import {
  reconcileOrphanedSessions,
  ORPHANED_NO_MAPPING_FAILURE_REASON,
  ORPHANED_REATTACH_FAILURE_REASON,
} from '../dispatcher-reconcile.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
import type { DispatcherMcpServer, HarnessSession } from '../dispatcher-support.js'
import type { Agent, Run, RunId, SessionRunMapping } from '../types.js'
import { fixture, harness, makeMapping, makeRun, makeTask } from './dispatcher-reconcile-fixture.js'

describe('reconcileOrphanedSessions (Decision 121, P3.1)', () => {
  it('marks runs stalled with the explicit reason when adapter does not implement tryReattach', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      adapters: new Map([['codex-app-server', harness()]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.stalled).toEqual(['r1'])
    expect(summary.reattached).toEqual([])
    expect(fx.stateMachine.markStalled).toHaveBeenCalledWith('r1')
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', ORPHANED_REATTACH_FAILURE_REASON, true)
    // Mapping is dropped so a follow-up retry doesn't bind to dead session id.
    expect(fx.sessionMappingRepo.delete).toHaveBeenCalledWith('sess-r1')
    expect(fx.evidence[0]?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'startup_orphan_sessions',
      restartTime: '2026-06-14T12:00:00.000Z',
      counts: { scanned: 1, live: 0, reattached: 0, stalled: 1, noMapping: 0, errors: 0 },
      affectedAttemptIds: ['r1'],
      stalledAttemptIds: ['r1'],
      stalledReasons: [{ runId: 'r1', reason: ORPHANED_REATTACH_FAILURE_REASON }],
    })
  })

  it('does not stall ship runs waiting for approval on startup', async () => {
    const run = makeRun('r1', 'agent-1', { stage: 'ship', pendingApproval: true })
    const fx = fixture({
      runs: [run],
      mappings: [makeMapping('r1')],
      adapters: new Map([['codex-app-server', harness()]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.scanned).toBe(1)
    expect(summary.stalled).toEqual([])
    expect(summary.reattached).toEqual([])
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
    expect(fx.runRepo.updateFailure).not.toHaveBeenCalled()
    expect(fx.sessionMappingRepo.delete).not.toHaveBeenCalled()
  })

  it('does not stall implementation runs that already have downstream review work', async () => {
    const run = makeRun('r1')
    const fx = fixture({
      runs: [run],
      mappings: [makeMapping('r1')],
      tasks: [
        makeTask('task-1', 'P1', { status: 'active' }),
        makeTask('task-review', 'review-P1', { requiredRole: 'reviewer', status: 'ready' }),
      ],
      adapters: new Map([['codex-app-server', harness()]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.scanned).toBe(1)
    expect(summary.stalled).toEqual([])
    expect(summary.reattached).toEqual([])
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
    expect(fx.runRepo.updateFailure).not.toHaveBeenCalled()
    expect(fx.sessionMappingRepo.delete).not.toHaveBeenCalled()
  })

  it('marks runs stalled when the harness session id was never reported', async () => {
    const m = makeMapping('r1')
    m.harnessSessionId = null
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [m],
      adapters: new Map([['codex-app-server', harness({
        tryReattach: vi.fn().mockResolvedValue({ sessionId: 'x' } as HarnessSession),
      })]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.stalled).toEqual(['r1'])
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', ORPHANED_REATTACH_FAILURE_REASON, true)
  })

  it('marks runs stalled when the adapter is no longer registered', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1', 'opencode' as SessionRunMapping['harness'])],
      adapters: new Map(), // no adapters
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.noAdapter).toEqual(['r1'])
    expect(summary.stalled).toEqual(['r1'])
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith(
      'r1',
      `${ORPHANED_REATTACH_FAILURE_REASON} (no adapter for opencode)`,
      true,
    )
  })

  it('reattaches runs successfully when adapter.tryReattach returns a session', async () => {
    const session: HarnessSession = {
      sessionId: 'reattached-sess',
      runId: 'r1' as RunId,
      waitForCompletion: vi.fn().mockResolvedValue({
        exitReason: 'completed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      }),
    }
    const tryReattach = vi.fn().mockResolvedValue(session)
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      adapters: new Map([['codex-app-server', harness({ tryReattach })]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.reattached).toEqual(['r1'])
    expect(summary.stalled).toEqual([])
    expect(fx.activeSessions.has('r1' as RunId)).toBe(true)
    expect(tryReattach).toHaveBeenCalledOnce()
    expect(fx.stateMachine.markStalled).not.toHaveBeenCalled()
  })

  it('skips runs that already have a live activeSessions entry', async () => {
    const active = new Map<RunId, ActiveDispatchSession>()
    active.set('r1' as RunId, {
      agentId: 'a' as Run['agentId'],
      agent: {} as Agent,
      adapter: harness(),
      session: { sessionId: 'live', runId: 'r1' as RunId, waitForCompletion: vi.fn() } as HarnessSession,
      mcpServer: {} as DispatcherMcpServer,
      released: false,
    })
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      adapters: new Map([['codex-app-server', harness({ tryReattach: vi.fn() })]]),
      active,
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.alreadyLive).toBe(1)
    expect(summary.reattached).toEqual([])
    expect(summary.stalled).toEqual([])
  })

  it('treats reattach errors as stalled with explicit reason', async () => {
    const tryReattach = vi.fn().mockRejectedValue(new Error('thread expired'))
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [makeMapping('r1')],
      adapters: new Map([['codex-app-server', harness({ tryReattach })]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.stalled).toEqual(['r1'])
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]?.error).toContain('thread expired')
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith(
      'r1',
      `${ORPHANED_REATTACH_FAILURE_REASON} (reattach error: thread expired)`,
      true,
    )
  })

  it('marks noMapping runs stalled so they do not remain ghost active attempts', async () => {
    const fx = fixture({
      runs: [makeRun('r1')],
      mappings: [],
      adapters: new Map([['codex-app-server', harness()]]),
    })

    const summary = await reconcileOrphanedSessions(fx)

    expect(summary.noMapping).toEqual(['r1'])
    expect(summary.stalled).toEqual(['r1'])
    expect(fx.stateMachine.markStalled).toHaveBeenCalledWith('r1')
    expect(fx.runRepo.updateFailure).toHaveBeenCalledWith('r1', ORPHANED_NO_MAPPING_FAILURE_REASON, true)
  })
})
