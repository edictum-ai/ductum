import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_AUTO_WAIT_MS,
  classifyHarnessOutcome,
  resolveAutoWaitMs,
} from '../dispatcher-limits.js'
import type { HarnessSessionResult } from '../dispatcher-support.js'

function failed(failReason: string, failureEvidence?: Record<string, unknown>): HarnessSessionResult {
  return { exitReason: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0, failReason, ...(failureEvidence ? { failureEvidence } : {}) }
}

describe('classifyHarnessOutcome', () => {
  it('classifies rate-limit / network / 5xx as transient', () => {
    expect(classifyHarnessOutcome(failed('HTTP 429 rate limit exceeded')).kind).toBe('transient')
    expect(classifyHarnessOutcome(failed('socket hang up (ECONNRESET)')).kind).toBe('transient')
    expect(classifyHarnessOutcome(failed('upstream 503 service unavailable')).kind).toBe('transient')
  })

  it('classifies out-of-credits / billing / auth as recoverable-external', () => {
    expect(classifyHarnessOutcome(failed('402 insufficient_quota: out of credits')).kind).toBe('recoverable-external')
    expect(classifyHarnessOutcome(failed('401 invalid api key')).kind).toBe('recoverable-external')
    expect(classifyHarnessOutcome(failed('billing: account past due')).kind).toBe('recoverable-external')
  })

  it('classifies bad-request / context overflow as terminal, and defaults unknown to terminal', () => {
    expect(classifyHarnessOutcome(failed('400 context length exceeded')).kind).toBe('terminal')
    expect(classifyHarnessOutcome(failed('prompt_overflow')).kind).toBe('terminal')
    expect(classifyHarnessOutcome(failed('something weird happened')).kind).toBe('terminal')
  })

  it('honors an explicit failureEvidence.category override', () => {
    expect(classifyHarnessOutcome(failed('400 bad request', { category: 'transient' })).kind).toBe('transient')
  })

  it('classifies budget/turn pauses as policy', () => {
    expect(classifyHarnessOutcome({ exitReason: 'paused-cost-budget', tokensIn: 0, tokensOut: 0, costUsd: 0 }).kind).toBe('policy')
    expect(classifyHarnessOutcome({ exitReason: 'paused-max-turns', tokensIn: 0, tokensOut: 0, costUsd: 0 }).kind).toBe('policy')
  })

  it('extracts retry-after hints from evidence and free text', () => {
    expect(classifyHarnessOutcome(failed('429', { retryAfterSeconds: 30 })).retryAfterMs).toBe(30_000)
    expect(classifyHarnessOutcome(failed('429', { retryAfterMs: 1500 })).retryAfterMs).toBe(1500)
    expect(classifyHarnessOutcome(failed('rate limited, retry after 45 seconds')).retryAfterMs).toBe(45_000)
  })
})

describe('resolveAutoWaitMs', () => {
  const now = 1_000_000
  it('returns the retry-after when within the cap', () => {
    expect(resolveAutoWaitMs({ kind: 'transient', retryAfterMs: 5_000, resetAt: null, detail: '' }, now)).toBe(5_000)
  })
  it('computes the wait from an absolute resetAt', () => {
    const resetAt = new Date(now + 12_000).toISOString()
    expect(resolveAutoWaitMs({ kind: 'transient', retryAfterMs: null, resetAt, detail: '' }, now)).toBe(12_000)
  })
  it('returns null when the wait exceeds the cap (→ failover/freeze)', () => {
    expect(resolveAutoWaitMs({ kind: 'recoverable-external', retryAfterMs: DEFAULT_MAX_AUTO_WAIT_MS + 1, resetAt: null, detail: '' }, now)).toBeNull()
  })
  it('returns null when no hint is available', () => {
    expect(resolveAutoWaitMs({ kind: 'recoverable-external', retryAfterMs: null, resetAt: null, detail: '' }, now)).toBeNull()
  })
})
