/**
 * Local-log cost scanner for Codex and Claude Code sessions.
 *
 * Replaces OpenRouter list pricing with cost computed from the agents'
 * own session logs. The motivation: OpenRouter's list price for Codex
 * (gpt-5.4 at $2.50/M input) does not account for Codex's aggressive
 * input caching, which routinely cuts effective input cost by 70-90%.
 * Cache-aware pricing applied to the real measured token deltas in the
 * log file matches what OpenAI actually bills within a few percent.
 *
 * Source files scanned:
 *   - ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (live sessions)
 *   - ~/.codex/archived_sessions/*.jsonl           (older sessions)
 *   - ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * Cost formula:
 *   Codex:  (input - cached) * inputRate + cached * cachedRate + output * outputRate
 *   Claude: input * inputRate + cacheRead * cacheReadRate + cacheCreation * cacheCreationRate + output * outputRate
 *
 * Sessions are looked up by their stable identifier:
 *   - Codex:  session_meta.id (matches the codex Thread.id from the SDK)
 *   - Claude: top-level sessionId field on each line (matches @anthropic-ai
 *             /claude-agent-sdk's session id, also embedded in the file name)
 *
 * The scanner is intentionally conservative: it never throws when a file
 * is malformed, returns null when a session can't be found, and caches
 * results for 60 seconds so the dispatcher can poll without thrashing
 * the filesystem. The dispatcher and run-control routes call into the
 * scanner; everything else is fallback to OpenRouter / static pricing.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { log } from './logger.js'
import { MODEL_REGISTRY, resolveModelEntry } from './model-registry.js'

/**
 * Per-token rates in USD. Kept per-token (not per-1M) to match
 * codexbar's vendored CostUsagePricing.swift exactly so we can verify
 * dollar-for-dollar against the codexbar reference implementation.
 */
export interface ScannerRates {
  inputPerToken: number
  outputPerToken: number
  cachedReadPerToken?: number
  cacheCreationPerToken?: number
}

/**
 * Cache-aware Codex rates. Derived from `MODEL_REGISTRY` so the
 * scanner and the registry cannot drift. Entries are restricted to
 * models with `scannerKind: 'codex'`.
 */
export const CODEX_RATES: Record<string, ScannerRates> = Object.freeze(
  Object.fromEntries(
    MODEL_REGISTRY
      .filter((entry) => entry.scannerKind === 'codex' && entry.rates != null)
      .map((entry) => [entry.id, entry.rates]),
  ),
) as Record<string, ScannerRates>

/**
 * Cache-aware Claude rates. Derived from `MODEL_REGISTRY` so the
 * scanner and the registry cannot drift. Includes GLM models routed
 * through the Claude harness so their logs are not silently re-priced
 * at Sonnet rates.
 */
export const CLAUDE_RATES: Record<string, ScannerRates> = Object.freeze(
  Object.fromEntries(
    MODEL_REGISTRY
      .filter((entry) => entry.scannerKind === 'claude' && entry.rates != null)
      .map((entry) => [entry.id, entry.rates]),
  ),
) as Record<string, ScannerRates>

export interface ScannedSessionTotals {
  /** Stable session identifier. Codex thread id, or Claude session id. */
  sessionId: string
  /** Working directory the session ran in (when present in the log). */
  cwd: string | null
  /** Last model seen in the session — sessions can swap models mid-run. */
  model: string | null
  /** Net (uncached) input tokens — the portion that's billed at the
   *  full input rate. */
  inputTokens: number
  /** Cached input tokens — billed at the cache-read rate. */
  cachedInputTokens: number
  /** Cache creation tokens (Claude only). Billed at cache creation rate. */
  cacheCreationInputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Cost in USD computed via cache-aware rates. */
  costUsd: number
  /**
   * Whether `costUsd` is a trustworthy measurement. `false` when any
   * token-bearing model in the session lacked pricing rates — usage IS
   * known (tokens are still counted) but the dollar figure is not.
   * Callers must surface that as "unpriced" (we know tokens, not the
   * rate), distinct from a scanner miss which is "unmeasured" (no usage
   * at all). A genuine $0 spend (no tokens) is `measured: true`.
   */
  measured: boolean
  /** ISO timestamp of the latest token_count event in the session. */
  lastUpdated: string | null
  /** Source file path the session was parsed from. Useful for debugging. */
  sourcePath: string
}

/**
 * Discriminated cost answer. The scanner and the pricing fallback
 * return this instead of a bare `0` when a run's cost cannot be
 * determined, so "unknown" stays distinct from "genuinely free":
 *
 *   - `{ measured: true, usd }`                — priced from real usage.
 *   - `{ measured: false, reason: 'unpriced' }`  — usage known (tokens
 *     present) but the model has no rate; we know the tokens, not the cost.
 *   - `{ measured: false, reason: 'unmeasured' }` — no usage known
 *     (scanner miss / no tokens); we don't even know the tokens.
 *
 * The dashboard renders `unpriced` and `unmeasured` distinctly rather
 * than "$0"/"free". See `measuredCostFromSession` and `computeMeasuredCost`.
 */
export type MeasuredCost =
  | { measured: true; usd: number }
  | { measured: false; reason: 'unpriced' | 'unmeasured' }

export type ScannerKind = 'codex' | 'claude'

export interface ScannerOptions {
  /** Override the home directory used for resolving log roots. Tests pass
   *  a tmp dir; production callers leave this unset. */
  homeDir?: string
  /** Cache TTL in milliseconds. Defaults to 60s. Tests pass 0 for no cache. */
  cacheTtlMs?: number
  /** Limit the scan to files modified within this many days. Defaults to
   *  14 days; older files are skipped to keep the index small. */
  maxAgeDays?: number
  /** Optional clock for tests. */
  now?: () => number
}

interface CacheEntry {
  loadedAt: number
  byId: Map<string, ScannedSessionTotals>
}

/**
 * Stateful scanner. One instance per process is enough — pricing is
 * static, the cache is keyed by kind, and reads are cheap.
 */
export class CostScanner {
  private readonly homeDir: string
  private readonly cacheTtlMs: number
  private readonly maxAgeDays: number
  private readonly nowFn: () => number
  private readonly caches = new Map<ScannerKind, CacheEntry>()

  constructor(options: ScannerOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir()
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000
    this.maxAgeDays = options.maxAgeDays ?? 14
    this.nowFn = options.now ?? Date.now
  }

  /**
   * Look up a Codex session by its thread id. Returns null when the
   * session is not in any of the scanned roots.
   */
  getCodexSession(sessionId: string): ScannedSessionTotals | null {
    return this.getIndex('codex').get(sessionId) ?? null
  }

  /**
   * Look up a Claude session by its sessionId field. Returns null when
   * the session is not in any of the scanned project dirs.
   */
  getClaudeSession(sessionId: string): ScannedSessionTotals | null {
    return this.getIndex('claude').get(sessionId) ?? null
  }

  /** Force a refresh on the next lookup. Tests use this to bypass the TTL. */
  invalidate(kind?: ScannerKind): void {
    if (kind == null) this.caches.clear()
    else this.caches.delete(kind)
  }

  /** Number of sessions currently indexed for the given kind. */
  size(kind: ScannerKind): number {
    return this.getIndex(kind).size
  }

  private getIndex(kind: ScannerKind): Map<string, ScannedSessionTotals> {
    const cached = this.caches.get(kind)
    if (cached != null && this.nowFn() - cached.loadedAt < this.cacheTtlMs) {
      return cached.byId
    }
    const byId = new Map<string, ScannedSessionTotals>()
    const files = this.discoverFiles(kind)
    for (const filePath of files) {
      try {
        const session = kind === 'codex'
          ? parseCodexSessionFile(filePath)
          : parseClaudeSessionFile(filePath)
        if (session == null) continue
        const existing = byId.get(session.sessionId)
        // If a session id appears in multiple files (rare — usually only
        // when a session is archived mid-life), prefer the one with the
        // larger total token count.
        if (existing == null || (session.inputTokens + session.outputTokens) > (existing.inputTokens + existing.outputTokens)) {
          byId.set(session.sessionId, session)
        }
      } catch (error) {
        log.warn('cost-scanner', `failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.caches.set(kind, { loadedAt: this.nowFn(), byId })
    return byId
  }

  private discoverFiles(kind: ScannerKind): string[] {
    const cutoffMs = this.nowFn() - this.maxAgeDays * 86_400_000
    if (kind === 'codex') {
      const out: string[] = []
      const sessionsRoot = path.join(this.homeDir, '.codex', 'sessions')
      const archivedRoot = path.join(this.homeDir, '.codex', 'archived_sessions')
      walkJsonl(sessionsRoot, cutoffMs, out)
      walkJsonl(archivedRoot, cutoffMs, out)
      return out
    }
    const projectsRoot = path.join(this.homeDir, '.claude', 'projects')
    const out: string[] = []
    walkJsonl(projectsRoot, cutoffMs, out)
    return out
  }
}

function walkJsonl(root: string, cutoffMs: number, out: string[]): void {
  if (!safeStat(root)) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      walkJsonl(full, cutoffMs, out)
      continue
    }
    if (!entry.isFile() || !full.endsWith('.jsonl')) continue
    const stat = safeStat(full)
    if (stat == null) continue
    if (stat.mtimeMs < cutoffMs) continue
    out.push(full)
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

/**
 * Parse a single codex session jsonl into accumulated totals. Returns
 * null when the file has no token_count events (e.g. an aborted session
 * with only the meta line).
 */
export function parseCodexSessionFile(filePath: string): ScannedSessionTotals | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  let sessionId: string | null = null
  let cwd: string | null = null
  let currentModel: string | null = null
  let lastUpdated: string | null = null

  // Codex emits CUMULATIVE session totals each turn (total_token_usage),
  // so we accumulate by tracking the high-water mark across all entries
  // and recomputing the delta. Simpler: just take the last total and
  // use it directly — the latest line has the full session aggregate.
  let lastTotal: { input: number; cached: number; output: number } | null = null
  // Per-model accumulation, since codex can swap models mid-session.
  // We keep a map of model → cumulative bill for cost computation.
  const perModel = new Map<string, { input: number; cached: number; output: number }>()
  let prevTotal = { input: 0, cached: 0, output: 0 }

  for (const rawLine of lines) {
    if (rawLine === '') continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(rawLine) as Record<string, unknown>
    } catch {
      continue
    }
    const type = typeof entry.type === 'string' ? entry.type : null
    const payload = (typeof entry.payload === 'object' && entry.payload != null)
      ? entry.payload as Record<string, unknown>
      : null

    if (type === 'session_meta' && payload != null) {
      const id = readString(payload, 'id') ?? readString(payload, 'session_id') ?? readString(payload, 'sessionId')
      if (id != null && sessionId == null) sessionId = id
      const cwdVal = readString(payload, 'cwd')
      if (cwdVal != null) cwd = cwdVal
      continue
    }

    if (type === 'turn_context' && payload != null) {
      const model = readString(payload, 'model')
      if (model != null) currentModel = model
      continue
    }

    if (type === 'event_msg' && payload != null) {
      const innerType = readString(payload, 'type')
      if (innerType !== 'token_count') continue
      const info = (typeof payload.info === 'object' && payload.info != null)
        ? payload.info as Record<string, unknown>
        : null
      if (info == null) continue
      const totalUsage = (typeof info.total_token_usage === 'object' && info.total_token_usage != null)
        ? info.total_token_usage as Record<string, unknown>
        : null
      if (totalUsage == null) continue
      const total = {
        input: readNumber(totalUsage, 'input_tokens') ?? 0,
        cached: readNumber(totalUsage, 'cached_input_tokens') ?? 0,
        output: readNumber(totalUsage, 'output_tokens') ?? 0,
      }
      const ts = typeof entry.timestamp === 'string' ? entry.timestamp : null
      if (ts != null) lastUpdated = ts
      // Compute delta against prevTotal and credit it to the current model.
      // Codex's cumulative counters reset across turns occasionally
      // (truncation, summarization), so a delta < 0 means a counter
      // reset — in that case treat the new total as the new baseline
      // and skip the negative delta to avoid undercounting.
      const dInput = total.input - prevTotal.input
      const dCached = total.cached - prevTotal.cached
      const dOutput = total.output - prevTotal.output
      if (dInput >= 0 && dOutput >= 0) {
        // Track tokens under the model name actually reported in the
        // session log. Unknown models accumulate under their raw id so
        // their tokens are still surfaced in the snapshot, but no
        // silent fallback rate is applied — pricing skips them later.
        const modelKey = normalizeCodexModel(currentModel) ?? currentModel ?? '(unknown)'
        const acc = perModel.get(modelKey) ?? { input: 0, cached: 0, output: 0 }
        acc.input += dInput
        acc.cached += Math.max(0, Math.min(dCached, dInput))
        acc.output += dOutput
        perModel.set(modelKey, acc)
      }
      prevTotal = total
      lastTotal = total
    }
  }

  if (sessionId == null || lastTotal == null) return null

  let costUsd = 0
  let totalInput = 0
  let totalCached = 0
  let totalOutput = 0
  let anyUnmeasured = false
  for (const [modelKey, totals] of perModel.entries()) {
    const uncached = Math.max(0, totals.input - totals.cached)
    totalInput += uncached
    totalCached += totals.cached
    totalOutput += totals.output
    const rates = CODEX_RATES[modelKey]
    if (rates == null) {
      // Unknown model — tokens are still counted but cost stays
      // unmeasured. No silent fallback to gpt-5.4 rates.
      if (totals.input + totals.output > 0) anyUnmeasured = true
      continue
    }
    costUsd += uncached * rates.inputPerToken
    costUsd += totals.cached * (rates.cachedReadPerToken ?? rates.inputPerToken * 0.1)
    costUsd += totals.output * rates.outputPerToken
  }

  return {
    sessionId,
    cwd,
    model: currentModel,
    inputTokens: totalInput,
    cachedInputTokens: totalCached,
    cacheCreationInputTokens: 0,
    outputTokens: totalOutput,
    costUsd,
    measured: !anyUnmeasured,
    lastUpdated,
    sourcePath: filePath,
  }
}

/**
 * Parse a single claude-agent-sdk session jsonl into accumulated totals.
 * Returns null for files with no assistant `usage` blocks (e.g. partial
 * sessions, user-only files).
 */
export function parseClaudeSessionFile(filePath: string): ScannedSessionTotals | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  let sessionId: string | null = null
  let cwd: string | null = null
  let lastModel: string | null = null
  let lastUpdated: string | null = null
  // Claude usage is reported per-message and is NOT cumulative — each
  // assistant message has its own usage block, so we sum directly.
  const perModel = new Map<string, {
    input: number
    cacheRead: number
    cacheCreation: number
    output: number
  }>()

  for (const rawLine of lines) {
    if (rawLine === '') continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(rawLine) as Record<string, unknown>
    } catch {
      continue
    }
    const sid = readString(entry, 'sessionId')
    if (sid != null && sessionId == null) sessionId = sid
    const cwdVal = readString(entry, 'cwd')
    if (cwdVal != null) cwd = cwdVal
    const ts = readString(entry, 'timestamp')
    if (ts != null) lastUpdated = ts

    if (entry.type !== 'assistant') continue
    const message = (typeof entry.message === 'object' && entry.message != null)
      ? entry.message as Record<string, unknown>
      : null
    if (message == null) continue
    const model = readString(message, 'model')
    if (model != null) lastModel = model
    const usage = (typeof message.usage === 'object' && message.usage != null)
      ? message.usage as Record<string, unknown>
      : null
    if (usage == null) continue

    const modelKey = normalizeClaudeModel(model)
      ?? normalizeClaudeModel(lastModel)
      ?? model
      ?? lastModel
      ?? '(unknown)'
    const acc = perModel.get(modelKey) ?? { input: 0, cacheRead: 0, cacheCreation: 0, output: 0 }
    acc.input += readNumber(usage, 'input_tokens') ?? 0
    acc.cacheRead += readNumber(usage, 'cache_read_input_tokens') ?? 0
    acc.cacheCreation += readNumber(usage, 'cache_creation_input_tokens') ?? 0
    acc.output += readNumber(usage, 'output_tokens') ?? 0
    perModel.set(modelKey, acc)
  }

  if (sessionId == null || perModel.size === 0) return null

  let costUsd = 0
  let totalInput = 0
  let totalCacheRead = 0
  let totalCacheCreation = 0
  let totalOutput = 0
  let anyUnmeasured = false
  for (const [modelKey, totals] of perModel.entries()) {
    totalInput += totals.input
    totalCacheRead += totals.cacheRead
    totalCacheCreation += totals.cacheCreation
    totalOutput += totals.output
    const rates = CLAUDE_RATES[modelKey]
    if (rates == null) {
      // Unknown model — tokens are still counted but cost stays
      // unmeasured. No silent fallback to claude-sonnet-4-6 rates.
      if (totals.input + totals.cacheRead + totals.cacheCreation + totals.output > 0) anyUnmeasured = true
      continue
    }
    costUsd += totals.input * rates.inputPerToken
    costUsd += totals.cacheRead * (rates.cachedReadPerToken ?? rates.inputPerToken * 0.1)
    costUsd += totals.cacheCreation * (rates.cacheCreationPerToken ?? rates.inputPerToken * 1.25)
    costUsd += totals.output * rates.outputPerToken
  }

  return {
    sessionId,
    cwd,
    model: lastModel,
    inputTokens: totalInput,
    cachedInputTokens: totalCacheRead,
    cacheCreationInputTokens: totalCacheCreation,
    outputTokens: totalOutput,
    costUsd,
    measured: !anyUnmeasured,
    lastUpdated,
    sourcePath: filePath,
  }
}

function normalizeCodexModel(model: string | null | undefined): string | null {
  if (model == null) return null
  const entry = resolveModelEntry(model)
  if (entry == null || entry.scannerKind !== 'codex') return null
  return entry.id
}

function normalizeClaudeModel(model: string | null | undefined): string | null {
  if (model == null) return null
  const entry = resolveModelEntry(model)
  if (entry == null || entry.scannerKind !== 'claude') return null
  return entry.id
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === 'string' && v !== '' ? v : null
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Reduce a scanned session (or a scanner miss) to the discriminated
 * cost answer. A `null` session — the scanner found no usage log for
 * the run — is `unmeasured` (no usage known), NOT a $0 measurement.
 * A found session whose token-bearing model lacked rates is `unpriced`
 * (usage known, rate missing). This is the marker the recording path
 * threads so the dashboard renders "unpriced"/"unmeasured", not "$0".
 */
export function measuredCostFromSession(session: ScannedSessionTotals | null): MeasuredCost {
  if (session == null) return { measured: false, reason: 'unmeasured' }
  return session.measured
    ? { measured: true, usd: session.costUsd }
    : { measured: false, reason: 'unpriced' }
}

/**
 * Process-wide singleton — created once on first use, with default
 * options. Tests use the class directly with a tmpdir homeDir.
 */
let defaultScanner: CostScanner | null = null

export function getDefaultCostScanner(): CostScanner {
  if (defaultScanner == null) defaultScanner = new CostScanner()
  return defaultScanner
}

/** Reset the default scanner (used by tests that mutate process state). */
export function resetDefaultCostScanner(): void {
  defaultScanner = null
}
