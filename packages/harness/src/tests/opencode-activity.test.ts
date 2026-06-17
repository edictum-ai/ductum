import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createActivityCursor, postCompletionActivity, processNewMessages } from '../opencode-activity.js'
import type { OpenCodeSessionMessageWithParts } from '../opencode-rest.js'
import { jsonResponse } from './helpers.js'

describe('opencode-activity', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('processNewMessages', () => {
    it('posts text activity for text parts', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        {
          info: { role: 'assistant', tokens: { input: 10, output: 5 }, cost: 0.01 },
          parts: [{ type: 'text', text: 'Reading the file...' } as { type: string }],
        },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      expect(activityCalls).toHaveLength(1)
      const body = JSON.parse(String(activityCalls[0]?.[1]?.body))
      expect(body.kind).toBe('text')
      expect(body.content).toBe('Reading the file...')
    })

    it('posts tool_call activity for tool-invocation parts', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        {
          info: { role: 'assistant', tokens: { input: 10, output: 5 }, cost: 0.01 },
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: { toolName: 'Bash', args: { command: 'git status' }, state: 'completed' },
            } as unknown as { type: string },
          ],
        },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      expect(activityCalls).toHaveLength(1)
      const body = JSON.parse(String(activityCalls[0]?.[1]?.body))
      expect(body.kind).toBe('tool_call')
      expect(body.toolName).toBe('Bash')
      expect(body.content).toContain('git status')
    })

    it('posts tool_call activity for tool_use parts (alternative format)', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        {
          info: { role: 'assistant', tokens: { input: 10, output: 5 }, cost: 0.01 },
          parts: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test.ts' } } as unknown as { type: string },
          ],
        },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      expect(activityCalls).toHaveLength(1)
      const body = JSON.parse(String(activityCalls[0]?.[1]?.body))
      expect(body.kind).toBe('tool_call')
      expect(body.toolName).toBe('Read')
    })

    it('posts token deltas for each assistant message', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        { info: { role: 'assistant', tokens: { input: 10, output: 5 }, cost: 0.05 }, parts: [] },
        { info: { role: 'assistant', tokens: { input: 20, output: 8 }, cost: 0.08 }, parts: [] },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tokens'))
      expect(tokenCalls).toHaveLength(2)

      const first = JSON.parse(String(tokenCalls[0]?.[1]?.body))
      expect(first).toEqual({ tokensIn: 10, tokensOut: 5, costUsd: 0.05 })

      const second = JSON.parse(String(tokenCalls[1]?.[1]?.body))
      expect(second).toEqual({ tokensIn: 20, tokensOut: 8, costUsd: 0.08 })
    })

    it('skips user messages', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'Do the thing' } as { type: string }] },
        { info: { role: 'assistant', tokens: { input: 5, output: 3 }, cost: 0.01 }, parts: [] },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      // Only 1 token call (for assistant), no activity for user message text
      const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tokens'))
      expect(tokenCalls).toHaveLength(1)
    })

    it('advances cursor and does not re-process old messages', () => {
      const cursor = createActivityCursor()

      // First batch
      const batch1: OpenCodeSessionMessageWithParts[] = [
        { info: { role: 'assistant', tokens: { input: 10, output: 5 }, cost: 0.05 }, parts: [] },
      ]
      processNewMessages('http://api.test', 'run-1' as any, batch1, cursor)
      expect(cursor.nextIndex).toBe(1)
      expect(cursor.tokensIn).toBe(10)

      // Second batch (includes the first message + a new one)
      const batch2: OpenCodeSessionMessageWithParts[] = [
        ...batch1,
        { info: { role: 'assistant', tokens: { input: 15, output: 7 }, cost: 0.07 }, parts: [] },
      ]
      processNewMessages('http://api.test', 'run-1' as any, batch2, cursor)
      expect(cursor.nextIndex).toBe(2)
      expect(cursor.tokensIn).toBe(25)

      // Only 2 total token posts (1 from each batch), not 3
      const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tokens'))
      expect(tokenCalls).toHaveLength(2)
    })

    it('handles messages with no tokens gracefully', () => {
      const messages: OpenCodeSessionMessageWithParts[] = [
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hello' } as { type: string }] },
      ]
      const cursor = createActivityCursor()

      processNewMessages('http://api.test', 'run-1' as any, messages, cursor)

      // Activity still posted for the text part
      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      expect(activityCalls).toHaveLength(1)

      // No token post (all zeros)
      const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/tokens'))
      expect(tokenCalls).toHaveLength(0)
    })
  })

  describe('postCompletionActivity', () => {
    it('posts a result activity with exit reason and cost', () => {
      const cursor = createActivityCursor()
      cursor.costUsd = 0.42

      postCompletionActivity('http://api.test', 'run-1' as any, 'completed', cursor)

      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      expect(activityCalls).toHaveLength(1)
      const body = JSON.parse(String(activityCalls[0]?.[1]?.body))
      expect(body.kind).toBe('result')
      expect(body.content).toContain('completed')
      expect(body.content).toContain('$0.42')
    })

    it('omits cost when zero', () => {
      const cursor = createActivityCursor()

      postCompletionActivity('http://api.test', 'run-1' as any, 'killed', cursor)

      const activityCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/activity'))
      const body = JSON.parse(String(activityCalls[0]?.[1]?.body))
      expect(body.content).toBe('session ended - killed')
      expect(body.content).not.toContain('$')
    })
  })
})
