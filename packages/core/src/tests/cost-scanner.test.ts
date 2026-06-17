import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CLAUDE_RATES,
  CODEX_RATES,
  CostScanner,
  measuredCostFromSession,
  parseClaudeSessionFile,
  parseCodexSessionFile,
} from '../cost-scanner.js'
import { writeClaudeSession as writeClaudeSessionIn, writeCodexSession as writeCodexSessionIn } from './cost-scanner-helpers.js'

let homeDir: string

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-cost-scanner-'))
})

afterEach(() => {
  fs.rmSync(homeDir, { recursive: true, force: true })
})

function writeCodexSession(
  sessionId: string,
  cwd: string,
  model: string,
  totals: Array<{ input: number; cached: number; output: number }>,
  options: { archived?: boolean; date?: string } = {},
): string {
  return writeCodexSessionIn(homeDir, sessionId, cwd, model, totals, options)
}

function writeClaudeSession(
  sessionId: string,
  cwd: string,
  model: string,
  messages: Array<{ input: number; cacheRead: number; cacheCreation: number; output: number }>,
): string {
  return writeClaudeSessionIn(homeDir, sessionId, cwd, model, messages)
}

describe('parseCodexSessionFile', () => {
  it('aggregates cumulative totals into deltas with cache split', () => {
    const filePath = writeCodexSession(
      'sess-1',
      '/tmp/work',
      'gpt-5.4',
      [
        { input: 1000, cached: 200, output: 50 },
        { input: 2200, cached: 1000, output: 120 },
        { input: 4500, cached: 3000, output: 200 },
      ],
    )
    const session = parseCodexSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.sessionId).toBe('sess-1')
    expect(session!.cwd).toBe('/tmp/work')
    expect(session!.model).toBe('gpt-5.4')
    // input deltas: 1000 + 1200 + 2300 = 4500 total
    // cached deltas: 200 + 800 + 2000 = 3000 cached
    // uncached: 4500 - 3000 = 1500
    expect(session!.inputTokens).toBe(1500)
    expect(session!.cachedInputTokens).toBe(3000)
    expect(session!.outputTokens).toBe(200)
  })

  it('computes cache-aware cost using gpt-5.4 rates', () => {
    const filePath = writeCodexSession('sess-2', '/tmp/work', 'gpt-5.4', [
      { input: 100_000, cached: 80_000, output: 10_000 },
    ])
    const session = parseCodexSessionFile(filePath)
    const rates = CODEX_RATES['gpt-5.4']!
    const expected = 20_000 * rates.inputPerToken
      + 80_000 * (rates.cachedReadPerToken ?? 0)
      + 10_000 * rates.outputPerToken
    expect(session!.costUsd).toBeCloseTo(expected, 6)
  })

  it('uses gpt-5.5 scanner rates instead of falling back to gpt-5.4', () => {
    const filePath = writeCodexSession('sess-gpt-55', '/tmp/work', 'gpt-5.5', [
      { input: 100_000, cached: 80_000, output: 10_000 },
    ])
    const session = parseCodexSessionFile(filePath)
    const rates = CODEX_RATES['gpt-5.5']!
    const expected = 20_000 * rates.inputPerToken
      + 80_000 * (rates.cachedReadPerToken ?? 0)
      + 10_000 * rates.outputPerToken
    expect(session!.model).toBe('gpt-5.5')
    expect(session!.costUsd).toBeCloseTo(expected, 6)
  })

  it('returns null for files without token_count events', () => {
    const dir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '07')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'rollout-2026-04-07T12-00-00-empty.jsonl')
    fs.writeFileSync(filePath, JSON.stringify({
      timestamp: '2026-04-07T12:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'empty', cwd: '/tmp' },
    }) + '\n')
    expect(parseCodexSessionFile(filePath)).toBeNull()
  })

  it('handles cumulative-counter resets gracefully', () => {
    const filePath = writeCodexSession('sess-reset', '/tmp/work', 'gpt-5.4', [
      { input: 5000, cached: 1000, output: 200 },
      // Simulated truncation/summarization — counters reset to lower
      // values. The scanner should ignore the negative delta and resume
      // accumulating from the new baseline.
      { input: 2000, cached: 500, output: 100 },
      { input: 3500, cached: 1500, output: 150 },
    ])
    const session = parseCodexSessionFile(filePath)
    // First delta: input 5000, cached 1000, output 200 → uncached 4000
    // Second delta is negative (skipped)
    // Third delta: input 1500, cached 1000, output 50 → uncached 500
    expect(session!.inputTokens).toBe(4500) // 4000 + 500
    expect(session!.cachedInputTokens).toBe(2000) // 1000 + 1000
    expect(session!.outputTokens).toBe(250)
  })
})

describe('parseClaudeSessionFile', () => {
  it('sums per-message usage into per-session totals', () => {
    const filePath = writeClaudeSession('claude-1', '/tmp/proj', 'claude-sonnet-4-6', [
      { input: 100, cacheRead: 0, cacheCreation: 5000, output: 200 },
      { input: 50, cacheRead: 5000, cacheCreation: 0, output: 150 },
      { input: 30, cacheRead: 5000, cacheCreation: 1000, output: 100 },
    ])
    const session = parseClaudeSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.sessionId).toBe('claude-1')
    expect(session!.inputTokens).toBe(180)
    expect(session!.cachedInputTokens).toBe(10_000)
    expect(session!.cacheCreationInputTokens).toBe(6000)
    expect(session!.outputTokens).toBe(450)
  })

  it('computes claude cost with cache rates', () => {
    const filePath = writeClaudeSession('claude-2', '/tmp/proj', 'claude-sonnet-4-6', [
      { input: 1000, cacheRead: 50_000, cacheCreation: 5000, output: 500 },
    ])
    const session = parseClaudeSessionFile(filePath)
    const rates = CLAUDE_RATES['claude-sonnet-4-6']!
    const expected = 1000 * rates.inputPerToken
      + 50_000 * (rates.cachedReadPerToken ?? 0)
      + 5000 * (rates.cacheCreationPerToken ?? 0)
      + 500 * rates.outputPerToken
    expect(session!.costUsd).toBeCloseTo(expected, 6)
  })
})

describe('CostScanner', () => {
  it('indexes codex sessions across live and archived dirs', () => {
    writeCodexSession('live-1', '/tmp/a', 'gpt-5.4', [{ input: 100, cached: 20, output: 10 }])
    writeCodexSession('archived-1', '/tmp/b', 'gpt-5.4', [{ input: 200, cached: 50, output: 20 }], { archived: true })

    const scanner = new CostScanner({ homeDir, cacheTtlMs: 0 })
    expect(scanner.size('codex')).toBe(2)
    expect(scanner.getCodexSession('live-1')).not.toBeNull()
    expect(scanner.getCodexSession('archived-1')).not.toBeNull()
    expect(scanner.getCodexSession('does-not-exist')).toBeNull()
  })

  it('caches results within the ttl', () => {
    writeCodexSession('cached-1', '/tmp/a', 'gpt-5.4', [{ input: 100, cached: 20, output: 10 }])
    const scanner = new CostScanner({ homeDir, cacheTtlMs: 60_000 })
    expect(scanner.size('codex')).toBe(1)

    // Add a new session after the cache was populated.
    writeCodexSession('cached-2', '/tmp/b', 'gpt-5.4', [{ input: 50, cached: 0, output: 5 }])
    // Cache should still report only the original session.
    expect(scanner.size('codex')).toBe(1)
    expect(scanner.getCodexSession('cached-2')).toBeNull()

    // Invalidating drops the cache; next lookup re-scans and sees both.
    scanner.invalidate('codex')
    expect(scanner.size('codex')).toBe(2)
    expect(scanner.getCodexSession('cached-2')).not.toBeNull()
  })

  it('skips files older than maxAgeDays', () => {
    const filePath = writeCodexSession('old-1', '/tmp/a', 'gpt-5.4', [{ input: 100, cached: 20, output: 10 }])
    // Backdate the file 30 days.
    const oldMs = Date.now() - 30 * 86_400_000
    fs.utimesSync(filePath, oldMs / 1000, oldMs / 1000)

    const scanner = new CostScanner({ homeDir, cacheTtlMs: 0, maxAgeDays: 14 })
    expect(scanner.size('codex')).toBe(0)
    expect(scanner.getCodexSession('old-1')).toBeNull()
  })

  it('indexes claude sessions by sessionId across project dirs', () => {
    writeClaudeSession('claude-A', '/tmp/proj-a', 'claude-sonnet-4-6', [
      { input: 100, cacheRead: 0, cacheCreation: 1000, output: 50 },
    ])
    writeClaudeSession('claude-B', '/tmp/proj-b', 'claude-opus-4-6', [
      { input: 200, cacheRead: 500, cacheCreation: 0, output: 100 },
    ])

    const scanner = new CostScanner({ homeDir, cacheTtlMs: 0 })
    expect(scanner.size('claude')).toBe(2)
    expect(scanner.getClaudeSession('claude-A')).not.toBeNull()
    expect(scanner.getClaudeSession('claude-B')?.model).toBe('claude-opus-4-6')
  })

  it('returns null for missing scanner roots without throwing', () => {
    const scanner = new CostScanner({ homeDir, cacheTtlMs: 0 })
    expect(scanner.size('codex')).toBe(0)
    expect(scanner.size('claude')).toBe(0)
  })
})

describe('measuredCostFromSession (unmeasured marker)', () => {
  it('a scanner miss is unmeasured, not $0', () => {
    // Headline case: the scanner found no usage log for the run. The
    // answer is { measured: false } — never { measured: true, usd: 0 },
    // which would read as "free" when the cost is actually unknown.
    expect(measuredCostFromSession(null)).toEqual({ measured: false })
  })

  it('a known-model session is measured with a real usd figure', () => {
    const filePath = writeCodexSession('measured-1', '/tmp/work', 'gpt-5.4', [
      { input: 100_000, cached: 80_000, output: 10_000 },
    ])
    const session = parseCodexSessionFile(filePath)
    expect(session!.measured).toBe(true)
    expect(session!.costUsd).toBeGreaterThan(0)
    const marker = measuredCostFromSession(session)
    expect(marker).toEqual({ measured: true, usd: session!.costUsd })
  })

  it('an unknown-model session is unmeasured even though tokens were counted', () => {
    // Tokens are still surfaced in the snapshot, but cost stays 0. That
    // 0 means unknown, not free — so the marker must be { measured: false }.
    const filePath = writeCodexSession('unmeasured-1', '/tmp/work', 'llama-42-enormous', [
      { input: 100_000, cached: 80_000, output: 10_000 },
    ])
    const session = parseCodexSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.inputTokens + session!.outputTokens).toBeGreaterThan(0)
    expect(session!.costUsd).toBe(0)
    expect(session!.measured).toBe(false)
    expect(measuredCostFromSession(session)).toEqual({ measured: false })
  })

  it('carries the measured marker for claude sessions too', () => {
    const known = writeClaudeSession('claude-measured', '/tmp/p', 'claude-sonnet-4-6', [
      { input: 1000, cacheRead: 0, cacheCreation: 5000, output: 500 },
    ])
    expect(parseClaudeSessionFile(known)!.measured).toBe(true)

    const unknown = writeClaudeSession('claude-unmeasured', '/tmp/p', 'llama-42-enormous', [
      { input: 1000, cacheRead: 0, cacheCreation: 5000, output: 500 },
    ])
    const session = parseClaudeSessionFile(unknown)
    expect(session!.costUsd).toBe(0)
    expect(session!.measured).toBe(false)
    expect(measuredCostFromSession(session)).toEqual({ measured: false })
  })
})
