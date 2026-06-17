import { describe, expect, it } from 'vitest'

import { envelope, listEnvelope } from '../lib/envelope.js'

describe('schema envelope helper', () => {
  it('wraps API payloads with the D135 schema envelope', () => {
    const now = () => new Date('2026-05-03T12:34:56.789Z')
    expect(envelope('run.cancelled', { runId: 'run-1' }, now)).toEqual({
      schemaVersion: 1,
      kind: 'run.cancelled',
      data: { runId: 'run-1' },
      ts: '2026-05-03T12:34:56.789Z',
    })
  })

  it('wraps lists under data.items', () => {
    const result = listEnvelope('task.list', [{ id: 'task-1' }], {
      nextCursor: 'next',
      now: () => new Date('2026-05-03T12:00:00.000Z'),
    })
    expect(result.data).toEqual({ items: [{ id: 'task-1' }], nextCursor: 'next' })
  })
})
