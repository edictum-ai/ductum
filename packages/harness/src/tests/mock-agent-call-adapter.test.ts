import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseReviewResult } from '@ductum/core'

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

  it('emits a structured review contract for deterministic review tasks', async () => {
    const adapter = new MockAgentCallHarnessAdapter('http://ductum.test', 'claude-agent-sdk')
    const run = createRun()
    const task = createTask({
      name: 'review-P1-HELLO-README',
      requiredRole: 'reviewer',
      prompt: 'Review the README bootstrap diff.',
    })

    const session = await adapter.spawn(run, task, '', {} as never)
    const result = await session.waitForCompletion()

    expect(result.exitReason).toBe('completed')
    const activityCall = fetchMock.mock.calls.find((call) => {
      const [, init] = call
      if (init == null || typeof init.body !== 'string') return false
      const body = JSON.parse(init.body) as { kind?: string; toolName?: string }
      return body.kind === 'tool_call' && body.toolName === 'ductum.complete'
    })
    expect(activityCall).toBeDefined()

    const [, init] = activityCall!
    const body = JSON.parse(init?.body as string) as { content: string }
    const completion = JSON.parse(body.content) as { result: string }

    expect(parseReviewResult(completion.result)).toEqual({
      verdict: 'pass',
      passed: true,
      feedback: 'README bootstrap diff matches the requested one-line change.',
    })
  })
})
