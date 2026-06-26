import { Writable } from 'node:stream'
import { vi, type Mock } from 'vitest'

import type { CliContext } from '../../runtime.js'

export type FetchMock = Mock

export function createFetchMock(overrides?: {
  handoffToken?: string | null | undefined
  token?: string | null | undefined
}): FetchMock {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/api/health')) return json({ ok: true, operatorTokenProtected: true })
    if (path.endsWith('/api/welcome/handoff')) {
      const data: Record<string, unknown> = {
        expiresAt: '2026-05-03T12:01:00.000Z',
        ttlSeconds: 60,
        welcomePath: '/welcome',
      }
      if (overrides != null && 'token' in overrides) data.token = overrides.token
      else data.handoffToken = overrides != null && 'handoffToken' in overrides
        ? overrides.handoffToken
        : 'handoff_secret'
      return json({
        data,
      })
    }
    return json({ error: 'not found' }, 404)
  })
}

export function createFailingHandoffFetch(): FetchMock {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url)
    if (path.endsWith('/api/health')) return json({ ok: true, operatorTokenProtected: true })
    if (path.endsWith('/api/welcome/handoff')) return json({ error: 'operator_secret' }, 500)
    return json({ error: 'not found' }, 404)
  })
}

export function protectedFetchCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/api/health'))
}

export function fakeContext(input: { outputMode: 'human' | 'ndjson'; stdout?: Writable; env?: Record<string, string> }): CliContext {
  const stdout = input.stdout ?? new TtyMemoryWritable()
  return {
    api: {} as CliContext['api'],
    apiUrl: 'http://localhost:4100',
    env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ...input.env },
    json: false,
    outputMode: input.outputMode,
    stdin: process.stdin,
    stdout,
    stderr: new MemoryWritable(),
    now: () => new Date('2026-05-03T12:00:00.000Z'),
    write: () => undefined,
    writeEnvelope: () => undefined,
    writeText: () => undefined,
  }
}

export class MemoryWritable extends Writable {
  private chunks: string[] = []
  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString())
    callback()
  }
  toString() { return this.chunks.join('') }
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

class TtyMemoryWritable extends MemoryWritable {
  isTTY = true
}
