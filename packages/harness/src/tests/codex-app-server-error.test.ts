import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { createRun, createTask, jsonResponse } from './helpers.js'

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

class FatalErrorCodexProcess extends EventEmitter {
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

  constructor(private readonly errorDetail: unknown = { code: 500, message: 'boom', meta: { retryable: false } }) {
    super()
  }

  kill(): void {
    this.emit('exit', 0, null)
  }

  private handleClientMessage(line: string): void {
    const msg = JSON.parse(line) as { id?: number; method?: string }
    if (msg.id != null) {
      const result = msg.method === 'thread/start'
        ? { thread: { id: 'thread-1' } }
        : {}
      this.stdout.write(`${JSON.stringify({ id: msg.id, result })}\n`)
    }
    if (msg.method === 'turn/start') {
      setImmediate(() => {
        this.stdout.write(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: { inputTokens: 220_000, outputTokens: 10 } })}\n`)
        this.stdout.write(`${JSON.stringify({ method: 'error', params: { error: this.errorDetail } })}\n`)
      })
    }
  }
}

describe('Codex app-server fatal error handling', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ activeStage: 'understand', stages: [] })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fails the session and preserves structured server error details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(spawn).mockReturnValue(new FatalErrorCodexProcess() as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )

    await expect(session.waitForCompletion()).resolves.toMatchObject({
      exitReason: 'failed',
      failReason: 'codex app-server error: {"code":500,"message":"boom","meta":{"retryable":false}}',
      failureEvidence: {
        category: 'terminal',
        kind: 'codex-app-server-error',
        detail: { code: 500, message: 'boom', meta: { retryable: false } },
      },
    })
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('[object Object]'))).toBe(false)
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('"code":500'))).toBe(true)
  })

  it('normalizes prompt-overflow server errors with context telemetry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(spawn).mockReturnValue(
      new FatalErrorCodexProcess({ code: 400, message: 'Prompt is too long for the maximum context window' }) as never,
    )

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )

    await expect(session.waitForCompletion()).resolves.toMatchObject({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        category: 'terminal',
        kind: 'codex-app-server.prompt_overflow',
        reason: 'prompt_overflow',
        signature: 'Prompt is too long',
        observedContext: {
          tokensIn: 220_000,
          maxInputTokensInTurn: 220_000,
          turns: 1,
        },
      },
    })
  })
})
