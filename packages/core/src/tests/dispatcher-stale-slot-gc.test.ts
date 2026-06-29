import { describe, expect, it } from 'vitest'

import { closeStaleSlots } from '../dispatcher-stale-slot-gc.js'
import { createFixture, seedImplRun } from './dispatcher/shared.js'

describe('dispatcher stale slot GC start window', () => {
  it('does not auto-close runs that are currently starting in this dispatcher', async () => {
    const fixture = createFixture()
    const events: unknown[] = []
    fixture.eventEmitter.subscribe((event) => events.push(event))
    const { run } = seedImplRun(fixture, 'starting-slot', {
      lastHeartbeat: '2026-04-04T11:55:59.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await closeStaleSlots({
      runRepo: fixture.context.runRepo,
      taskRepo: fixture.context.taskRepo,
      sessionMappingRepo: fixture.context.sessionRunMappingRepo,
      stateMachine: fixture.stateMachine,
      watcherManager: fixture.watcherManager,
      eventEmitter: fixture.eventEmitter,
      activeRunIds: new Set(),
      startingRunIds: new Set([run.id]),
      finishingRunIds: new Set(),
      now: new Date(fixture.nowRef.value),
    })

    expect(result.closed).toEqual([])
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: null,
      failReason: null,
    })
    expect(fixture.watcherManager.stopWatchers).not.toHaveBeenCalled()
    expect(events).not.toContainEqual({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
  })
})
