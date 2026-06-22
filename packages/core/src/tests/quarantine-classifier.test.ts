import { describe, expect, it } from 'vitest'

import { classifyRetryExhaustion, normalizeFailReason, type ClassifyRetryExhaustionInput } from '../quarantine-classifier.js'

function classify(overrides: Partial<ClassifyRetryExhaustionInput>): 'deterministic' | 'transient' {
  return classifyRetryExhaustion({
    cause: 'crash',
    failReason: 'tests failed: assertion foo',
    priorFailReasons: [],
    ...overrides,
  })
}

describe('classifyRetryExhaustion', () => {
  it('quarantines a non-recoverable failure that recurred across retries', () => {
    expect(
      classify({ failReason: 'tests failed: assertion foo', priorFailReasons: ['tests failed: assertion foo'] }),
    ).toBe('deterministic')
  })

  it('does not quarantine on first ambiguity (non-recoverable but no prior recurrence)', () => {
    expect(classify({ failReason: 'weird one-off error', priorFailReasons: [] })).toBe('transient')
    expect(
      classify({ failReason: 'weird one-off error', priorFailReasons: ['different earlier error'] }),
    ).toBe('transient')
  })

  it('keeps recoverable/provider failures out of quarantine even when recurring', () => {
    // auth failures are recoverable/transient (dispatcher-agent-health regex)
    expect(
      classify({ failReason: 'authentication expired', priorFailReasons: ['authentication expired'] }),
    ).toBe('transient')
    expect(
      classify({ failReason: 'ECONNREFUSED', priorFailReasons: ['ECONNREFUSED'] }),
    ).toBe('transient')
  })

  it('heartbeat stalls are never poison', () => {
    expect(
      classify({ cause: 'heartbeat', failReason: 'tests failed: assertion foo', priorFailReasons: ['tests failed: assertion foo'] }),
    ).toBe('transient')
  })

  it('forceTransient overrides everything (provider backoff / failover exhaustion)', () => {
    expect(
      classify({ failReason: 'tests failed: assertion foo', priorFailReasons: ['tests failed: assertion foo'], forceTransient: true }),
    ).toBe('transient')
  })

  it('empty / synthetic-placeholder reasons never carry poison evidence', () => {
    expect(classify({ failReason: null, priorFailReasons: [null] })).toBe('transient')
    expect(classify({ failReason: '', priorFailReasons: [''] })).toBe('transient')
    expect(classify({ failReason: 'stalled', priorFailReasons: ['stalled'] })).toBe('transient')
    expect(classify({ failReason: 'harness_failed', priorFailReasons: ['harness_failed'] })).toBe('transient')
  })

  it('normalizes volatile suffixes so the same poison signature matches', () => {
    const a = 'tests failed: assertion foo (run abc123def456ghi789 at 2026-06-18T10:00:00Z)'
    const b = 'tests failed: assertion foo (run zzz999yyy888xxx777 at 2026-06-19T11:30:00Z)'
    expect(normalizeFailReason(a)).toBe(normalizeFailReason(b))
    expect(classify({ failReason: a, priorFailReasons: [b] })).toBe('deterministic')
  })
})
