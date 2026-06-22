import { describe, expect, it } from 'vitest'

import {
  CLAUDE_RATES,
  CODEX_RATES,
  MODEL_REGISTRY,
  MODEL_PRICING,
  lookupPricing,
  lookupScannerRates,
  parseClaudeSessionFile,
  parseCodexSessionFile,
  pricingStateForEntry,
  resolveModelEntry,
} from '../index.js'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('MODEL_REGISTRY', () => {
  it('includes gpt-5.4 and gpt-5.5 with codex scanner rates', () => {
    const gpt54 = MODEL_REGISTRY.find((e) => e.id === 'gpt-5.4')
    const gpt55 = MODEL_REGISTRY.find((e) => e.id === 'gpt-5.5')
    expect(gpt54?.scannerKind).toBe('codex')
    expect(gpt55?.scannerKind).toBe('codex')
    expect(gpt55?.rates?.inputPerToken).toBe(5e-6)
    expect(gpt55?.rates?.outputPerToken).toBe(3e-5)
  })

  it('has no duplicate ids or provider model aliases', () => {
    const ids = MODEL_REGISTRY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const providerIds = MODEL_REGISTRY.map((e) => e.providerModelId ?? e.id)
    expect(new Set(providerIds).size).toBe(providerIds.length)
  })

  it('records official source verification metadata for every entry', () => {
    for (const entry of MODEL_REGISTRY) {
      expect(entry.sourceUrl, `id=${entry.id}`).toMatch(/^https:\/\//)
      expect(entry.lastVerifiedAt, `id=${entry.id}`).toBe('2026-06-13')
    }
  })

  it('derives MODEL_PRICING from per-token rates × 1e6', () => {
    for (const entry of MODEL_REGISTRY) {
      if (entry.rates == null) {
        expect(MODEL_PRICING[entry.id]).toBeUndefined()
      } else {
        expect(MODEL_PRICING[entry.id]).toEqual({
          inputUsdPer1M: entry.rates.inputPerToken * 1_000_000,
          outputUsdPer1M: entry.rates.outputPerToken * 1_000_000,
        })
      }
    }
  })

  it('derives CODEX_RATES from registry entries marked codex', () => {
    const codexEntries = MODEL_REGISTRY.filter((e) => e.scannerKind === 'codex' && e.rates != null)
    expect(Object.keys(CODEX_RATES).sort()).toEqual(codexEntries.map((e) => e.id).sort())
    for (const entry of codexEntries) {
      expect(CODEX_RATES[entry.id]).toBe(entry.rates)
    }
  })

  it('derives CLAUDE_RATES from registry entries marked claude', () => {
    const claudeEntries = MODEL_REGISTRY.filter((e) => e.scannerKind === 'claude' && e.rates != null)
    expect(Object.keys(CLAUDE_RATES).sort()).toEqual(claudeEntries.map((e) => e.id).sort())
    for (const entry of claudeEntries) {
      expect(CLAUDE_RATES[entry.id]).toBe(entry.rates)
    }
  })

  it('keeps catalog/scanner parity — entries with scanner rates are pricing-resolvable', () => {
    for (const entry of MODEL_REGISTRY) {
      const pricing = lookupPricing(entry.id)
      if (pricingStateForEntry(entry) === 'unmeasured') {
        expect(pricing, `id=${entry.id}`).toBeNull()
        expect(entry.pricingNote, `id=${entry.id}`).toMatch(/pricing/i)
      } else {
        expect(pricing, `id=${entry.id}`).not.toBeNull()
      }
      // Cache-aware lookup only succeeds for entries with scanner logs.
      const scannerRates = lookupScannerRates(entry.id)
      if (entry.scannerKind === 'none' || entry.rates == null) {
        expect(scannerRates, `id=${entry.id}`).toBeNull()
      } else {
        expect(scannerRates, `id=${entry.id}`).toBe(entry.rates)
      }
    }
  })

  it('resolves date-suffixed aliases without prefix-matching unrelated models', () => {
    expect(resolveModelEntry('claude-sonnet-4-6-20261001')?.id).toBe('claude-sonnet-4-6')
    expect(resolveModelEntry('claude-sonnet-4-6-2026-10-01')?.id).toBe('claude-sonnet-4-6')
    expect(resolveModelEntry('openai/gpt-5.4')?.id).toBe('gpt-5.4')
    expect(resolveModelEntry('claude-opus-4-8')?.id).toBe('claude-opus-4-8')

    // Unrelated families do not silently fall back.
    expect(resolveModelEntry('gpt-5.6')).toBeNull()
    expect(resolveModelEntry('llama-42-enormous')).toBeNull()
  })

  it('returns unmeasured (null) for unknown models', () => {
    expect(lookupPricing('gpt-5.6')).toBeNull()
    expect(lookupPricing('llama-42-enormous')).toBeNull()
    expect(lookupScannerRates('llama-42-enormous')).toBeNull()
  })

  it('keeps research-preview pricing explicitly unmeasured', () => {
    const spark = resolveModelEntry('gpt-5.3-codex-spark')
    expect(spark?.availability).toBe('research-preview')
    expect(spark?.rates).toBeUndefined()
    expect(lookupPricing('gpt-5.3-codex-spark')).toBeNull()
    expect(lookupScannerRates('gpt-5.3-codex-spark')).toBeNull()
  })

  it('does not claim Claude-harness support for Z.AI API-only rows', () => {
    expect(resolveModelEntry('glm-5.2')?.supportedHarnesses).toContain('claude-agent-sdk')
    expect(resolveModelEntry('glm-5.2[1m]')?.id).toBe('glm-5.2')
    expect(resolveModelEntry('glm-5.2')?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(resolveModelEntry('glm-5.2')?.note).toMatch(/low\/medium\/high map to GLM high/)
    expect(resolveModelEntry('glm-5.2')?.note).toMatch(/xhigh\/max map to GLM max/)
    // GLM-5.2 has official published Z.AI pricing ($1.4/M in, $4.4/M out) — no placeholder note.
    expect(resolveModelEntry('glm-5.2')?.pricingNote).toBeUndefined()
    expect(resolveModelEntry('glm-5.2')?.rates?.inputPerToken).toBeCloseTo(1.4e-6, 9)
    expect(resolveModelEntry('glm-5.1')?.supportedHarnesses).toContain('claude-agent-sdk')
    expect(resolveModelEntry('glm-5')?.supportedHarnesses).toEqual([])
    expect(resolveModelEntry('glm-5v-turbo')?.supportedHarnesses).toEqual([])
    expect(resolveModelEntry('glm-5v')).toBeNull()
  })

  it('keeps suspended Claude Fable 5 visible but unroutable', () => {
    expect(resolveModelEntry('claude-fable-5')).toMatchObject({
      availability: 'deprecated',
      supportedHarnesses: [],
      note: expect.stringMatching(/suspended June 12, 2026/i),
    })
  })

  it('does not claim Codex-harness support for OpenAI pro API rows without a proven route', () => {
    expect(resolveModelEntry('gpt-5.5-pro')).toMatchObject({
      availability: 'api',
      supportedHarnesses: [],
      scannerKind: 'none',
    })
    expect(resolveModelEntry('gpt-5.4-pro')).toMatchObject({
      availability: 'api',
      supportedHarnesses: [],
      scannerKind: 'none',
    })
  })
})

describe('scanner unmeasured-model behavior', () => {
  let homeDir: string
  function tmp(): string {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ductum-registry-'))
    return homeDir
  }

  it('returns 0 cost for an unknown Codex model — no silent gpt-5.4 fallback', () => {
    tmp()
    const dir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '07')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'rollout-2026-04-07T12-00-00-sess-unknown.jsonl')
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-07T12:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'sess-unknown', cwd: '/tmp/work', originator: 'codex_exec' },
      }),
      JSON.stringify({
        timestamp: '2026-04-07T12:00:00.500Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.6-experimental', cwd: '/tmp/work' },
      }),
      JSON.stringify({
        timestamp: '2026-04-07T12:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 100_000,
              cached_input_tokens: 80_000,
              output_tokens: 10_000,
            },
          },
        },
      }),
    ]
    fs.writeFileSync(filePath, lines.join('\n') + '\n')

    const session = parseCodexSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.outputTokens).toBe(10_000)
    // Cost MUST be 0 — unknown model is unmeasured, not silently
    // priced at gpt-5.4 rates.
    expect(session!.costUsd).toBe(0)
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('returns 0 cost for an unknown Claude model — no silent sonnet fallback', () => {
    tmp()
    const cwd = '/tmp/proj-x'
    const dir = path.join(homeDir, '.claude', 'projects', `-${cwd.replaceAll('/', '-')}`)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'claude-unknown.jsonl')
    const lines = [
      JSON.stringify({
        sessionId: 'claude-unknown',
        cwd,
        type: 'assistant',
        timestamp: '2026-04-07T12:00:00.000Z',
        message: {
          model: 'unknown-anthropic-model',
          type: 'message',
          usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: 2000,
            output_tokens: 500,
          },
        },
      }),
    ]
    fs.writeFileSync(filePath, lines.join('\n') + '\n')

    const session = parseClaudeSessionFile(filePath)
    expect(session).not.toBeNull()
    expect(session!.inputTokens).toBe(1000)
    expect(session!.outputTokens).toBe(500)
    expect(session!.costUsd).toBe(0)
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('returns null when usage data is missing (no token_count / no assistant usage)', () => {
    tmp()
    const codexDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '07')
    fs.mkdirSync(codexDir, { recursive: true })
    const codexPath = path.join(codexDir, 'rollout-2026-04-07T12-00-00-empty.jsonl')
    fs.writeFileSync(codexPath, JSON.stringify({
      timestamp: '2026-04-07T12:00:00.000Z',
      type: 'session_meta',
      payload: { id: 'empty', cwd: '/tmp' },
    }) + '\n')
    expect(parseCodexSessionFile(codexPath)).toBeNull()

    const claudeDir = path.join(homeDir, '.claude', 'projects', '-tmp-proj-empty')
    fs.mkdirSync(claudeDir, { recursive: true })
    const claudePath = path.join(claudeDir, 'claude-empty.jsonl')
    fs.writeFileSync(claudePath, JSON.stringify({
      sessionId: 'claude-empty',
      cwd: '/tmp/proj-empty',
      type: 'user',
      timestamp: '2026-04-07T12:00:00.000Z',
    }) + '\n')
    expect(parseClaudeSessionFile(claudePath)).toBeNull()
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('still measures known models alongside unknown ones in the same Codex session', () => {
    tmp()
    const dir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '07')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'rollout-2026-04-07T12-00-00-mixed.jsonl')
    const lines = [
      JSON.stringify({
        timestamp: '2026-04-07T12:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'mixed', cwd: '/tmp/work', originator: 'codex_exec' },
      }),
      JSON.stringify({
        timestamp: '2026-04-07T12:00:00.500Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', cwd: '/tmp/work' },
      }),
      JSON.stringify({
        timestamp: '2026-04-07T12:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 100_000,
              cached_input_tokens: 80_000,
              output_tokens: 10_000,
            },
          },
        },
      }),
    ]
    fs.writeFileSync(filePath, lines.join('\n') + '\n')

    const session = parseCodexSessionFile(filePath)
    expect(session?.costUsd).toBeGreaterThan(0)
    fs.rmSync(homeDir, { recursive: true, force: true })
  })
})
