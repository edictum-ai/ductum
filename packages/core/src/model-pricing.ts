/**
 * Per-model token pricing — derived from `model-registry`.
 *
 * Cost is computed at the persistence boundary (runRepo updateTokens
 * flow, dispatcher handleSessionEnd) from the agent's model + token
 * deltas. Harness-reported costs are IGNORED because:
 *
 * - Codex SDK and codex-app-server hardcode 0.
 * - Even Anthropic's cost field drifts from published rates.
 * - Different routes (Claude direct vs GLM via Anthropic-compat)
 *   report differently for the same model.
 *
 * Three layers of pricing resolution, highest precedence first:
 *
 *   1. **Per-agent override** from the Agent record's `pricing` field
 *      (DB-backed Factory Settings).
 *   2. **OpenRouter live pricing** — fetched once on dispatcher
 *      startup. Always public list pricing, cached for the server
 *      lifetime.
 *   3. **Registry-derived static fallback** — last resort if
 *      OpenRouter is unreachable AND no per-agent override is
 *      configured.
 *
 * Unknown ids return `null` from `lookupPricing` — no silent
 * prefix-match fallback to an unrelated model. Callers treat `null`
 * as the explicit `unmeasured` signal (run cost stays 0, UI surfaces
 * `cost.state: 'unmeasured'`).
 *
 * Rates exposed by this module are in USD per 1M tokens.
 */

import type { MeasuredCost, ScannerRates } from './cost-scanner.js'
import { log } from './logger.js'
import {
  MODEL_REGISTRY,
  resolveModelEntry,
  type ModelRegistryEntry,
  type RegistryRates,
} from './model-registry.js'

export interface ModelPricing {
  inputUsdPer1M: number
  outputUsdPer1M: number
}

function ratesToPricing(rates: RegistryRates): ModelPricing {
  return {
    inputUsdPer1M: rates.inputPerToken * 1_000_000,
    outputUsdPer1M: rates.outputPerToken * 1_000_000,
  }
}

function entryToPricing(entry: ModelRegistryEntry): ModelPricing | null {
  return entry.rates == null ? null : ratesToPricing(entry.rates)
}

/**
 * Static fallback rates keyed by model id. Derived from the registry
 * so adding a model is a single edit. Per-1M shape kept for backward
 * compatibility with existing callers (dispatcher, run-control, tests).
 *
 * Aliases are NOT included as keys here — use `lookupPricing()` for
 * alias-aware resolution. This map only holds canonical ids.
 */
export const MODEL_PRICING: Record<string, ModelPricing | undefined> = Object.freeze(
  Object.fromEntries(MODEL_REGISTRY.flatMap((entry) => {
    const pricing = entryToPricing(entry)
    return pricing == null ? [] : [[entry.id, pricing]]
  })),
) as Record<string, ModelPricing | undefined>

const livePricing = new Map<string, ModelPricing>()
let livePricingLoadedAt: number | null = null

export function getLivePricingLoadedAt(): number | null {
  return livePricingLoadedAt
}

export function getLivePricingSize(): number {
  return livePricing.size
}

/**
 * Fetch current public-list pricing from OpenRouter and cache it.
 * Safe to call multiple times — the second call refreshes the cache.
 *
 * OpenRouter's `pricing.prompt` and `pricing.completion` fields are
 * USD per token (not per million). We multiply up to per-1M for the
 * canonical ModelPricing shape.
 *
 * Best-effort enrichment. If the fetch fails for any reason, the
 * cache is left as-is and lookupPricing falls back to the registry.
 */
export async function refreshOpenRouterPricing(options: {
  url?: string
  fetchImpl?: typeof fetch
} = {}): Promise<number> {
  const url = options.url ?? 'https://openrouter.ai/api/v1/models'
  const fetchFn = options.fetchImpl ?? fetch
  try {
    const res = await fetchFn(url, { method: 'GET' })
    if (!res.ok) {
      log.warn('pricing', `OpenRouter pricing fetch returned ${res.status}; keeping cache`)
      return livePricing.size
    }
    const body = await res.json() as { data?: Array<{ id?: string; pricing?: { prompt?: string | number; completion?: string | number } }> }
    const models = Array.isArray(body.data) ? body.data : []
    let count = 0
    for (const m of models) {
      const id = m.id
      const p = m.pricing
      if (id == null || id === '' || p == null) continue
      const promptStr = p.prompt
      const completionStr = p.completion
      const promptPerTok = typeof promptStr === 'number' ? promptStr : Number(promptStr ?? 0)
      const completionPerTok = typeof completionStr === 'number' ? completionStr : Number(completionStr ?? 0)
      if (!Number.isFinite(promptPerTok) || !Number.isFinite(completionPerTok)) continue
      const entry: ModelPricing = {
        inputUsdPer1M: promptPerTok * 1_000_000,
        outputUsdPer1M: completionPerTok * 1_000_000,
      }
      const normalized = normalizeLiveKey(id)
      livePricing.set(normalized, entry)
      const slashIdx = normalized.indexOf('/')
      if (slashIdx >= 0) {
        livePricing.set(normalized.slice(slashIdx + 1), entry)
      }
      count++
    }
    livePricingLoadedAt = Date.now()
    log.info('pricing', `loaded ${count} model rates from OpenRouter`)
    return count
  } catch (error) {
    log.warn('pricing', `OpenRouter pricing fetch failed: ${error instanceof Error ? error.message : String(error)}`)
    return livePricing.size
  }
}

const warnedMissing = new Set<string>()

/** Normalization used for OpenRouter cache keys — matches what the
 *  live-pricing layer historically stored. The registry has its own
 *  alias-aware normalizer. */
function normalizeLiveKey(model: string): string {
  return model.toLowerCase().replaceAll('.', '-')
}

/**
 * Resolve a model id to a pricing entry.
 *
 * Resolution order:
 *   1. OpenRouter live cache (exact match on normalized key).
 *   2. Registry (exact match on id or alias, date suffix stripped).
 *
 * Returns null when the model is unknown. No silent prefix-match
 * across model families.
 */
export function lookupPricing(model: string | null | undefined): ModelPricing | null {
  if (model == null || model === '') return null
  const liveKey = normalizeLiveKey(model)
  if (livePricing.has(liveKey)) return livePricing.get(liveKey)!
  const slashIdx = liveKey.indexOf('/')
  if (slashIdx >= 0) {
    const noProvider = liveKey.slice(slashIdx + 1)
    if (livePricing.has(noProvider)) return livePricing.get(noProvider)!
  }
  const entry = resolveModelEntry(model)
  if (entry == null) return null
  return entryToPricing(entry)
}

/**
 * Compute USD cost from a token delta. Resolution order:
 *
 *   1. Caller-supplied override (per-agent `pricing` field).
 *   2. lookupPricing() — OpenRouter live → registry fallback.
 *
 * Returns 0 for unknown models after logging a one-time warning.
 * That 0 is the `unmeasured` signal — callers do not retroactively
 * substitute another model's price.
 */
export function computeCost(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  override?: ModelPricing | null,
): number {
  if (tokensIn <= 0 && tokensOut <= 0) return 0
  const pricing = override ?? lookupPricing(model)
  if (pricing == null) {
    const key = model ?? '(missing model)'
    if (!warnedMissing.has(key)) {
      warnedMissing.add(key)
      log.warn('pricing', `no pricing entry for model "${key}" — cost will be recorded as 0 (unmeasured)`)
    }
    return 0
  }
  const inputCost = (tokensIn * pricing.inputUsdPer1M) / 1_000_000
  const outputCost = (tokensOut * pricing.outputUsdPer1M) / 1_000_000
  return inputCost + outputCost
}

/**
 * Discriminated companion to `computeCost`: returns the explicit
 * `unmeasured` marker instead of a bare `0` when the model can't be
 * priced. Mirrors `measuredCostFromSession` (cost-scanner) so the
 * dispatcher's harness-token fallback and the local-log scanner path
 * speak the same `MeasuredCost` shape — letting the recording path
 * carry "unknown" instead of collapsing it to $0.
 *
 * Zero-token calls are `measured` (trivially $0): there is nothing
 * unknown about a run that did no billable work.
 */
export function computeMeasuredCost(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  override?: ModelPricing | null,
): MeasuredCost {
  if (tokensIn <= 0 && tokensOut <= 0) return { measured: true, usd: 0 }
  const pricing = override ?? lookupPricing(model)
  if (pricing == null) return { measured: false }
  const inputCost = (tokensIn * pricing.inputUsdPer1M) / 1_000_000
  const outputCost = (tokensOut * pricing.outputUsdPer1M) / 1_000_000
  return { measured: true, usd: inputCost + outputCost }
}

/**
 * Look up scanner-style per-token rates for a given model. Returns
 * `null` for models without on-disk session logs (`scannerKind:
 * 'none'`) and for unknown models. Callers fall back to the
 * cache-unaware path in either case.
 */
export function lookupScannerRates(model: string | null | undefined): ScannerRates | null {
  if (model == null || model === '') return null
  const entry = resolveModelEntry(model)
  if (entry == null || entry.scannerKind === 'none') return null
  if (entry.rates == null) return null
  return entry.rates
}

/**
 * Compute USD cost from a token delta with prompt-cache awareness.
 *
 * `tokensIn` is the GROSS input total (uncached + cached_read +
 * cache_creation). `cachedTokensIn` and `cacheCreationTokensIn` are
 * the subsets of `tokensIn` that are charged at the cached rate /
 * cache-creation rate respectively.
 *
 * Resolution order:
 *
 *   1. **Caller-supplied override** (per-agent pricing). The override
 *      schema only has flat input/output rates, so we apply it to the
 *      gross input total — same behavior as the cache-unaware path.
 *
 *   2. **Scanner rates** from the registry when the model has them
 *      AND the caller passed nonzero cached counts. This is the
 *      cheap-and-correct path for delta-mode runs where the
 *      local-log scanner has nothing to read yet.
 *
 *   3. **Cache-unaware fallback** to plain `computeCost` for unknown
 *      models or zero cached counts.
 *
 * Negative inputs are clamped to 0 so a buggy delta can never produce
 * a negative cost.
 */
export function computeCacheAwareCost(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  cachedTokensIn: number,
  cacheCreationTokensIn: number,
  override?: ModelPricing | null,
): number {
  const grossIn = Math.max(0, tokensIn)
  const out = Math.max(0, tokensOut)
  const cachedIn = Math.max(0, Math.min(cachedTokensIn, grossIn))
  const creationIn = Math.max(0, Math.min(cacheCreationTokensIn, grossIn - cachedIn))
  if (grossIn === 0 && out === 0) return 0

  if (override != null) {
    return computeCost(model, grossIn, out, override)
  }

  const rates = lookupScannerRates(model)
  if (rates == null || (cachedIn === 0 && creationIn === 0)) {
    return computeCost(model, grossIn, out)
  }

  const uncachedIn = Math.max(0, grossIn - cachedIn - creationIn)
  let cost = uncachedIn * rates.inputPerToken
  cost += cachedIn * (rates.cachedReadPerToken ?? rates.inputPerToken * 0.1)
  cost += creationIn * (rates.cacheCreationPerToken ?? rates.inputPerToken)
  cost += out * rates.outputPerToken
  return cost
}
