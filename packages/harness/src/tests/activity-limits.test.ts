import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getActivityMaxBytes, truncateActivity } from '../activity-limits.js'

const ORIGINAL_ENV = process.env.DUCTUM_ACTIVITY_MAX_BYTES

describe('getActivityMaxBytes', () => {
  beforeEach(() => {
    delete process.env.DUCTUM_ACTIVITY_MAX_BYTES
  })
  afterEach(() => {
    if (ORIGINAL_ENV == null) delete process.env.DUCTUM_ACTIVITY_MAX_BYTES
    else process.env.DUCTUM_ACTIVITY_MAX_BYTES = ORIGINAL_ENV
  })

  it('defaults to 64 KB when the env var is unset', () => {
    expect(getActivityMaxBytes()).toBe(64 * 1024)
  })

  it('reads the env var when set to a valid integer', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '8192'
    expect(getActivityMaxBytes()).toBe(8192)
  })

  it('ignores non-numeric values and falls back to the default', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = 'not-a-number'
    expect(getActivityMaxBytes()).toBe(64 * 1024)
  })

  it('ignores zero/negative values and falls back to the default', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '0'
    expect(getActivityMaxBytes()).toBe(64 * 1024)
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '-1'
    expect(getActivityMaxBytes()).toBe(64 * 1024)
  })

  it('floors fractional values to an integer', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '12345.7'
    expect(getActivityMaxBytes()).toBe(12345)
  })
})

describe('truncateActivity', () => {
  beforeEach(() => {
    delete process.env.DUCTUM_ACTIVITY_MAX_BYTES
  })
  afterEach(() => {
    if (ORIGINAL_ENV == null) delete process.env.DUCTUM_ACTIVITY_MAX_BYTES
    else process.env.DUCTUM_ACTIVITY_MAX_BYTES = ORIGINAL_ENV
  })

  it('returns content unchanged when under the cap', () => {
    expect(truncateActivity('hello world')).toBe('hello world')
  })

  it('returns an empty string as-is', () => {
    expect(truncateActivity('')).toBe('')
  })

  it('truncates long content and appends a marker with the dropped char count', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '200'
    const content = 'a'.repeat(1000)
    const result = truncateActivity(content)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result).toMatch(/\[… 800 chars truncated\]$/)
    expect(result.startsWith('a')).toBe(true)
  })

  it('never drops content below 16 chars even when the cap is tiny', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '20'
    const content = 'abcdefghijklmnopqrstuvwxyz' + 'x'.repeat(1000)
    const result = truncateActivity(content)
    // 16 chars preserved + marker text → result length > cap is OK
    // here because the floor guarantees readable content.
    expect(result.startsWith('abcdefghijklmnop')).toBe(true)
    expect(result).toMatch(/\[… \d.*chars truncated\]$/)
  })

  it('respects the default 64KB cap when env var is unset', () => {
    const content = 'x'.repeat(70_000)
    const result = truncateActivity(content)
    expect(result.length).toBeLessThanOrEqual(64 * 1024)
    expect(result).toMatch(/\[… \d.*chars truncated\]$/)
  })

  it('preserves content at exactly the cap without truncating', () => {
    process.env.DUCTUM_ACTIVITY_MAX_BYTES = '100'
    const content = 'x'.repeat(100)
    expect(truncateActivity(content)).toBe(content)
  })
})
