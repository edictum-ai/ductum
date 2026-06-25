import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { createRun, createTask, jsonResponse } from './helpers.js'

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

class StaleCodexProcess extends EventEmitter {
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
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(): boolean {
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  }

  private handleClientMessage(line: string): void {
    const msg = JSON.parse(line) as { id?: number; method?: string }
    if (msg.id == null) return
    const result = msg.method === 'thread/start' ? { thread: { id: 'thread-1' } } : {}
    this.stdout.write(`${JSON.stringify({ id: msg.id, result })}\n`)
  }
}

describe('Codex app-server worker liveness', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ activeStage: 'understand', stages: [] })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports the session dead when the worker child has exited without cleanup', async () => {
    const child = new StaleCodexProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )

    expect(await adapter.isAlive(session.sessionId)).toBe(true)
    child.exitCode = 1

    expect(await adapter.isAlive(session.sessionId)).toBe(false)
    await adapter.kill(session.sessionId)
  })
})
