import { describe, expect, it } from 'vitest'

import { DuctumEventEmitter, type DuctumEvent } from '../events.js'
import { createId } from '../types.js'

describe('DuctumEventEmitter', () => {
  it('subscribes, emits, and unsubscribes', () => {
    const emitter = new DuctumEventEmitter()
    const runId = createId<'RunId'>()
    const events: DuctumEvent[] = []

    const unsubscribe = emitter.subscribe((event) => {
      events.push(event)
    })

    emitter.emit({ type: 'run.heartbeat', runId })
    unsubscribe()
    emitter.emit({ type: 'run.heartbeat', runId })

    expect(events).toEqual([{ type: 'run.heartbeat', runId }])
  })
})
