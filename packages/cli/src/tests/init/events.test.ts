import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { writeInitCancelled, writeInitEvent } from '../../init/events.js'
import type { CliContext } from '../../runtime.js'

describe('init event public redaction', () => {
  it('redacts fake secrets and handoff tokens from init events', () => {
    const stdout = new MemoryWritable()
    const ctx = fakeContext(stdout)

    writeInitEvent(ctx, 'init.handoff_created', {
      handoffUrl: 'http://127.0.0.1:4777/welcome?token=handoff_secret',
      token: 'operator-secret-value',
      providerApiKey: 'sk-proj-test-secret',
    })
    writeInitCancelled(ctx, 'cancelled with ghp_testsecret')

    const text = stdout.toString()
    expect(text).not.toContain('handoff_secret')
    expect(text).not.toContain('operator-secret-value')
    expect(text).not.toContain('sk-proj-test-secret')
    expect(text).not.toContain('ghp_testsecret')
    expect(text.trim().split('\n').map((line) => JSON.parse(line).kind)).toEqual([
      'init.handoff_created',
      'init.cancelled',
    ])
  })
})

function fakeContext(stdout: Writable): CliContext {
  return {
    api: {} as CliContext['api'],
    apiUrl: 'http://localhost:4100',
    env: {},
    json: false,
    outputMode: 'ndjson',
    stdin: process.stdin,
    stdout,
    stderr: new MemoryWritable(),
    now: () => new Date('2026-05-03T12:00:00.000Z'),
    write: () => undefined,
    writeEnvelope: () => undefined,
    writeText: () => undefined,
  }
}

class MemoryWritable extends Writable {
  private chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString())
    callback()
  }

  toString() {
    return this.chunks.join('')
  }
}
