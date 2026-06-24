/**
 * Canonical harness telemetry contract (D163 §6).
 *
 * Owner: @ductum/core. The harness package re-exports these symbols
 * from `packages/harness/src/types.ts` so adapters and dispatcher
 * boundaries reference one definition. D162 requires `session.started`
 * to carry a non-empty string `harnessSessionId`; the union here makes
 * that requirement type-level so omitting it fails to compile.
 */

import type { CostTruthState } from './cost-truth.js'

export interface TokenUsageDelta {
  /**
   * Gross input token count for this turn (or sum of turns since the
   * last post). For agents that use prompt caching, this includes BOTH
   * the cached and uncached portions — `cachedTokensIn` is a subset.
   */
  tokensIn: number
  tokensOut: number
  /**
   * Harness-reported cost in USD. The /tokens route ignores this for
   * Codex (which always reports 0) and Anthropic (which drifts from
   * published rates), preferring server-side rate lookup. Kept for
   * backwards compatibility with older harnesses that reported cost directly.
   */
  costUsd: number
  /** Normalized runtime model used to compute/pronounce the cost truth. */
  model?: string
  /** Truthfulness marker for `costUsd`. */
  costState?: CostTruthState
  /**
   * Subset of `tokensIn` that hit prompt cache (cache-read for both
   * Codex and Claude). When set, the API can compute a cache-aware
   * cost: uncached at the input rate, cached at the discounted rate.
   * Optional so non-caching harnesses don't have to set it.
   */
  cachedTokensIn?: number
  /**
   * Anthropic-only: tokens spent on writing entries into the prompt
   * cache for the first time (cache_creation_input_tokens). Billed at
   * a higher rate than gross input. Codex doesn't expose this.
   */
  cacheCreationTokensIn?: number
}

export type HarnessEvent =
  | { type: 'session.started'; harnessSessionId: string }
  | { type: 'text.delta'; content: string }
  | { type: 'tool.requested'; toolName: string; args?: Record<string, unknown>; content?: string }
  | { type: 'tool.allowed'; toolName: string; args?: Record<string, unknown> }
  | { type: 'tool.blocked'; toolName: string; args?: Record<string, unknown>; content?: string; reason?: string }
  | { type: 'tool.result'; toolName?: string; args?: Record<string, unknown>; content?: string; success?: boolean }
  | { type: 'cost.updated'; usage: TokenUsageDelta }
  | { type: 'heartbeat' }
  | { type: 'needs_approval'; toolName: string; args?: Record<string, unknown>; content?: string }
  | { type: 'completed'; content?: string }
  | { type: 'failed'; content: string }
