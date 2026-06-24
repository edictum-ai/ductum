import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { createAgent, createRun, createTask, jsonResponse } from './helpers.js'

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

class CostReportingCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = {
    write: vi.fn((chunk: string) => {
      for (const line of chunk.trim().split('\n').filter(Boolean)) {
        this.handleClientMessage(line)
      }
      return true
    }),
  }

  kill(): void {
    this.emit('exit', 0, null)
  }

  private handleClientMessage(line: string): void {
    const msg = JSON.parse(line) as { id?: number; method?: string }
    if (msg.id != null) {
      const result = msg.method === 'thread/start'
        ? { thread: { id: 'thread-priced' } }
        : {}
      this.stdout.write(`${JSON.stringify({ id: msg.id, result })}\n`)
    }
    if (msg.method === 'turn/start') {
      setImmediate(() => {
        this.stdout.write(`${JSON.stringify({
          method: 'thread/tokenUsage/updated',
          params: { inputTokens: 500_000, outputTokens: 250_000 },
        })}\n`)
        this.stdout.write(`${JSON.stringify({ method: 'turn/completed' })}\n`)
        this.emit('exit', 0, null)
      })
    }
  }
}

class UnpricedErrorCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = {
    write: vi.fn((chunk: string) => {
      for (const line of chunk.trim().split('\n').filter(Boolean)) {
        this.handleClientMessage(line)
      }
      return true
    }),
  }

  kill(): void {
    this.emit('exit', 0, null)
  }

  private handleClientMessage(line: string): void {
    const msg = JSON.parse(line) as { id?: number; method?: string }
    if (msg.id != null) {
      const result = msg.method === 'thread/start'
        ? { thread: { id: 'thread-unpriced' } }
        : {}
      this.stdout.write(`${JSON.stringify({ id: msg.id, result })}\n`)
    }
    if (msg.method === 'turn/start') {
      setImmediate(() => {
        this.stdout.write(`${JSON.stringify({
          method: 'thread/tokenUsage/updated',
          params: { inputTokens: 12_345, outputTokens: 678 },
        })}\n`)
        this.stdout.write(`${JSON.stringify({
          method: 'error',
          params: { error: { code: 500, message: 'boom' } },
        })}\n`)
      })
    }
  }
}

describe('Codex app-server cost accounting', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ activeStage: 'understand', stages: [] }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts nonzero priced token usage and returns a priced completion snapshot for known Codex models', async () => {
    vi.mocked(spawn).mockReturnValue(new CostReportingCodexProcess() as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      {
        workingDir: '/tmp/ductum-run',
        agent: createAgent({ model: 'openai/gpt-5.4', harness: 'codex-app-server' as never }),
      },
    )

    const result = await session.waitForCompletion()
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))

    expect(tokenCalls).toHaveLength(1)
    expect(JSON.parse(String(tokenCalls[0]?.[1]?.body))).toEqual({
      tokensIn: 500000,
      tokensOut: 250000,
      costUsd: 5,
      model: 'gpt-5.4',
      costState: 'measured',
    })
    expect(result).toMatchObject({
      exitReason: 'completed',
      tokensIn: 500000,
      tokensOut: 250000,
      costUsd: 5,
      costState: 'measured',
    })
  })

  it('marks error snapshots unpriced instead of implying free spend when pricing is missing', async () => {
    vi.mocked(spawn).mockReturnValue(new UnpricedErrorCodexProcess() as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      {
        workingDir: '/tmp/ductum-run',
        agent: createAgent({ model: 'gpt-5.3-codex-spark', harness: 'codex-app-server' as never }),
      },
    )

    await expect(session.waitForCompletion()).resolves.toMatchObject({
      exitReason: 'failed',
      tokensIn: 12345,
      tokensOut: 678,
      costUsd: 0,
      costState: 'unpriced',
      failReason: 'codex app-server error: {"code":500,"message":"boom"}',
    })

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runs/run-1/tokens'))
    expect(JSON.parse(String(tokenCalls[0]?.[1]?.body))).toEqual({
      tokensIn: 12345,
      tokensOut: 678,
      costUsd: 0,
      model: 'gpt-5.3-codex-spark',
      costState: 'unpriced',
    })
  })
})
