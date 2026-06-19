import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MockAgentCallHarnessAdapter } from '../mock-agent-call-adapter.js'
import { createRun, createTask, jsonResponse } from './helpers.js'

describe('MockAgentCallHarnessAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can emit a deterministic poison crash for quarantine dogfood', async () => {
    const adapter = new MockAgentCallHarnessAdapter('http://ductum.test', 'claude-agent-sdk')
    const run = createRun()
    const task = createTask({
      prompt: 'DUCTUM_MOCK_POISON: deterministic poison: README invariant failed',
    })

    const session = await adapter.spawn(run, task, '', {} as never)
    const result = await session.waitForCompletion()

    expect(result).toEqual({
      exitReason: 'crashed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      failReason: 'deterministic poison: README invariant failed',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ductum.test/api/runs/run-1/activity',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'result',
          content: 'Mock deterministic poison: deterministic poison: README invariant failed',
        }),
      }),
    )
  })
})
