import { createId } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, seedBase, waitForSse, type TestFixture } from '../helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('API routes - agent-first events', () => {
  it('replays enveloped events after Last-Event-ID', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-04-04T12:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    fixture.context.events.emit({
      type: 'run.dispatched',
      runId: run.id,
      taskId: task.id,
      agentId: builder.id,
      agentName: builder.name,
      stage: 'understand',
    })
    const lastEventId = fixture.context.events.lastEventId()
    fixture.context.events.emit({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })

    const abort = new AbortController()
    const response = await fixture.app.request('/api/events', {
      headers: { accept: 'text/event-stream', 'Last-Event-ID': lastEventId },
      signal: abort.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    try {
      const text = await waitForSse(reader!, 'slot.auto_closed')
      const event = parseSseBlock(text, 'slot.auto_closed')
      expect(event.id).toBe(String(Number(lastEventId) + 1))
      expect(event.name).toBe('slot.auto_closed')
      expect(event.data).toMatchObject({
        schemaVersion: 1,
        kind: 'slot.auto_closed',
        data: { runId: run.id, reason: 'stale_slot_gc' },
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })

  it('renders max_turns_reached failures with D135 suggested actions', async () => {
    fixture = await createFixture()
    const { task, builder, reviewer } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'max_turns_reached',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: '2026-04-04T12:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    fixture.context.events.emit({ type: 'run.failed', runId: run.id, failReason: 'max_turns_reached' })
    const abort = new AbortController()
    const response = await fixture.app.request('/api/events', {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    })

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    try {
      const text = await waitForSse(reader!, 'run.failed')
      const event = parseSseBlock(text, 'run.failed')
      expect(event.data).toMatchObject({
        schemaVersion: 1,
        kind: 'run.failed',
        data: {
          runId: run.id,
          failReason: 'max_turns_reached',
          error: {
            kind: 'error',
            data: {
              code: 'max_turns_reached',
              recoverable: true,
              suggestedActions: [
                { kind: 'bump_max_turns', args: { currentLimit: 200, suggestedLimit: 300 } },
                { kind: 'retry_same_agent', args: { taskId: task.id, agentName: builder.name } },
                { kind: 'switch_agent', args: { taskId: task.id, candidateAgents: [{ id: reviewer.id }] } },
              ],
            },
          },
        },
      })
    } finally {
      abort.abort()
      reader?.releaseLock()
    }
  })
})

function parseSseBlock(text: string, eventName: string) {
  const block = text.split(/\n\n/).find((item) => item.includes(`event: ${eventName}`))
  expect(block).toBeDefined()
  const id = block?.match(/^id: ?(.+)$/m)?.[1]
  const name = block?.match(/^event: ?(.+)$/m)?.[1]
  const data = block?.match(/^data: ?(.+)$/m)?.[1]
  expect(id).toBeDefined()
  expect(name).toBeDefined()
  expect(data).toBeDefined()
  return { id: id!, name: name!, data: JSON.parse(data!) as unknown }
}
