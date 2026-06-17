import { describe, expect, it } from 'vitest'

import {
  createEnvelope,
  formatEnvelope,
  modeFromFlags,
  resolveOutputMode,
} from '../output.js'

describe('agent-first output helper', () => {
  it('resolves flags before env and TTY auto mode', () => {
    expect(resolveOutputMode({
      flags: { human: true },
      env: { DUCTUM_OUTPUT: 'json' },
      stdoutIsTTY: false,
    })).toBe('human')
    expect(resolveOutputMode({ env: { DUCTUM_OUTPUT: 'ndjson' }, stdoutIsTTY: true })).toBe('ndjson')
    expect(resolveOutputMode({ stdoutIsTTY: true })).toBe('human')
    expect(resolveOutputMode({ stdoutIsTTY: false })).toBe('json')
  })

  it('rejects conflicting per-invocation output flags', () => {
    expect(() => modeFromFlags({ json: true, human: true })).toThrow(/Choose only one output mode flag/)
  })

  it('formats JSON, NDJSON, and human envelopes', () => {
    const now = () => new Date('2026-05-03T12:34:56.789Z')
    expect(createEnvelope('task.updated', { id: 'task-1' }, now)).toEqual({
      schemaVersion: 1,
      kind: 'task.updated',
      data: { id: 'task-1' },
      ts: '2026-05-03T12:34:56.789Z',
    })
    expect(formatEnvelope('human', 'task.updated', { id: 'task-1' }, 'updated', now)).toBe('updated\n')
    expect(JSON.parse(formatEnvelope('ndjson', 'task.updated', { id: 'task-1' }, 'updated', now))).toMatchObject({
      kind: 'task.updated',
      data: { id: 'task-1' },
    })
    expect(formatEnvelope('json', 'task.updated', { id: 'task-1' }, 'updated', now)).toContain('"schemaVersion": 1')
  })

  it('redacts secrets and handoff tokens in NDJSON envelopes', () => {
    const now = () => new Date('2026-05-03T12:34:56.789Z')
    const line = formatEnvelope('ndjson', 'init.test', {
      handoffUrl: 'http://127.0.0.1:4777/welcome?token=handoff_secret',
      operatorToken: 'operator-secret-value',
      provider: { apiKey: 'sk-proj-test-secret' },
      encryptedSecret: { ciphertext: 'secret-ciphertext-value', authTag: 'secret-auth-tag', keyId: 'local:key-id' },
    }, 'created', now)
    const parsed = JSON.parse(line) as { data: Record<string, unknown> }

    expect(line).not.toContain('handoff_secret')
    expect(line).not.toContain('operator-secret-value')
    expect(line).not.toContain('sk-proj-test-secret')
    expect(line).not.toContain('secret-ciphertext-value')
    expect(line).not.toContain('secret-auth-tag')
    expect(line).not.toContain('local:key-id')
    expect(JSON.stringify(parsed.data)).toContain('[redacted]')
  })

  it('redacts secrets and encrypted material in JSON envelopes', () => {
    const now = () => new Date('2026-05-03T12:34:56.789Z')
    const text = formatEnvelope('json', 'init.test', {
      handoffUrl: 'http://127.0.0.1:4777/welcome?token=handoff_secret',
      provider: { apiKey: 'sk-proj-test-secret' },
      encryptedSecret: { ciphertext: 'secret-ciphertext-value', authTag: 'secret-auth-tag', keyId: 'local:key-id' },
    }, 'created', now)

    expect(text).not.toContain('handoff_secret')
    expect(text).not.toContain('sk-proj-test-secret')
    expect(text).not.toContain('secret-ciphertext-value')
    expect(text).not.toContain('secret-auth-tag')
    expect(text).not.toContain('local:key-id')
    expect(text).toContain('[redacted]')
  })
})
