/**
 * Canonical declarative model registry — types and lookup helpers.
 *
 * D163 names this module the single owner of pricing, scanner rates,
 * and catalog metadata. The three previously-duplicated tables —
 * `MODEL_PRICING` (per-1M, cache-unaware), `CODEX_RATES`/`CLAUDE_RATES`
 * (per-token, cache-aware), and the API `MODEL_CATALOG` — are all
 * derived from this list.
 *
 * Per-token rates are the canonical shape. Per-1M values are derived
 * by ×1_000_000 at the point of use so the two views cannot drift.
 *
 * Unknown ids are explicit `unmeasured`: callers receive `null` and
 * never inherit another model's pricing.
 */
import type { AgentEffort, Harness } from './types.js'
import { MODEL_REGISTRY } from './model-registry-data.js'

export { MODEL_REGISTRY } from './model-registry-data.js'

export type ModelProvider = 'openai' | 'anthropic' | 'zai'
export type ModelAvailability =
  | 'api'
  | 'subscription'
  | 'codex'
  | 'coding-plan'
  | 'research-preview'
  | 'deprecated'
export type ModelPricingState = 'measured' | 'unmeasured'
export type CachedReadPricingState = 'discounted' | 'no-discount' | 'default-heuristic'
/**
 * `codex`  — scanner reads ~/.codex/sessions/*.jsonl, cache-aware.
 * `claude` — scanner reads ~/.claude/projects/*.jsonl, cache-aware.
 * `none`   — no local scanner log; only cache-unaware pricing applies.
 *
 * Named `ModelScannerKind` (not `ScannerKind`) to avoid colliding
 * with the `CostScanner` kind in `cost-scanner.ts`, which is the
 * filesystem-source enum and a different vocabulary.
 */
export type ModelScannerKind = 'codex' | 'claude' | 'none'

export interface RegistryRates {
  inputPerToken: number
  outputPerToken: number
  cachedReadPerToken?: number
  /** Explicitly means "cached input is billed at the normal input rate". */
  cachedReadUsesInputRate?: boolean
  cacheCreationPerToken?: number
}

export interface ModelRegistryEntry {
  id: string
  label: string
  providerModelId?: string
  provider: ModelProvider
  availability: ModelAvailability
  supportedHarnesses: Harness[]
  supportedEfforts?: AgentEffort[]
  aliases: string[]
  defaultCostTier: number
  sourceUrl: string
  lastVerifiedAt: string
  note?: string
  scannerKind: ModelScannerKind
  rates?: RegistryRates
  pricingNote?: string
}

/**
 * Normalize a model id for registry lookup. Mirrors the scanner's
 * historic normalization: lowercase, strip provider prefix, strip
 * trailing date suffix (`-YYYY-MM-DD` or `-YYYYMMDD`). Does NOT
 * collapse `.` to `-` — entries use the canonical form (e.g.
 * `gpt-5.4`, `claude-sonnet-4-6`) and aliases cover both flavors.
 */
function normalizeForLookup(model: string): string {
  return model
    .toLowerCase()
    .trim()
    .replace(/^openai\//, '')
    .replace(/^anthropic[./-]/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{8}$/, '')
}

/** Secondary normalization used by the per-1M lookup path: also
 *  collapses `.` to `-` so `gpt-5.4` and `gpt-5-4` are equivalent. */
function normalizeIdLoose(model: string): string {
  return normalizeForLookup(model).replaceAll('.', '-')
}

let exactIndex: Map<string, ModelRegistryEntry> | null = null
let looseIndex: Map<string, ModelRegistryEntry> | null = null

function buildIndexes(): void {
  const exact = new Map<string, ModelRegistryEntry>()
  const loose = new Map<string, ModelRegistryEntry>()
  for (const entry of MODEL_REGISTRY) {
    const keys = [entry.id, entry.providerModelId, ...entry.aliases].filter((key): key is string => key != null)
    for (const key of keys) {
      const exactKey = normalizeForLookup(key)
      if (!exact.has(exactKey)) exact.set(exactKey, entry)
      const looseKey = normalizeIdLoose(key)
      if (!loose.has(looseKey)) loose.set(looseKey, entry)
    }
  }
  exactIndex = exact
  looseIndex = loose
}

function getExactIndex(): Map<string, ModelRegistryEntry> {
  if (exactIndex == null) buildIndexes()
  return exactIndex!
}

function getLooseIndex(): Map<string, ModelRegistryEntry> {
  if (looseIndex == null) buildIndexes()
  return looseIndex!
}

/**
 * Resolve a model id (or alias) to its registry entry.
 *
 * Matching is strict — no silent prefix-match across model families.
 * Date-suffixed variants like `gpt-5.4-2026-03-01` and
 * `claude-sonnet-4-6-20261001` are accepted because the date suffix
 * is stripped during normalization. Unrecognized ids return `null`.
 */
export function resolveModelEntry(model: string | null | undefined): ModelRegistryEntry | null {
  if (model == null || model === '') return null
  const exact = getExactIndex().get(normalizeForLookup(model))
  if (exact != null) return exact
  return getLooseIndex().get(normalizeIdLoose(model)) ?? null
}

/** Convenience accessor used by API catalog code. */
export function listModelRegistry(): ModelRegistryEntry[] {
  return MODEL_REGISTRY
}

export function providerModelIdForEntry(entry: ModelRegistryEntry): string {
  return entry.providerModelId ?? entry.id
}

export function pricingStateForEntry(entry: ModelRegistryEntry): ModelPricingState {
  return entry.rates == null ? 'unmeasured' : 'measured'
}

export function cachedReadPricingStateForRates(rates: RegistryRates): CachedReadPricingState {
  if (rates.cachedReadUsesInputRate === true) return 'no-discount'
  if (rates.cachedReadPerToken != null) {
    return rates.cachedReadPerToken === rates.inputPerToken ? 'no-discount' : 'discounted'
  }
  return 'default-heuristic'
}

export function resolveCachedReadPerToken(rates: RegistryRates): number {
  if (rates.cachedReadUsesInputRate === true) return rates.inputPerToken
  if (rates.cachedReadPerToken != null) return rates.cachedReadPerToken
  return rates.inputPerToken * 0.1
}
