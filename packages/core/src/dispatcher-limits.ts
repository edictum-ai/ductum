import type { HarnessSessionResult } from './dispatcher-support.js'

/**
 * Provider-limit classification for a harness outcome (design/04 §5, §6).
 *
 * - `transient`: rate-limit / network / 5xx — wait out the provider's
 *   retry-after (capped) then auto-resume from checkpoint, else short backoff.
 * - `recoverable-external`: out-of-credits / billing / auth (401/402/quota) —
 *   wait if a reset is near, else fail over to another provider's agent, else
 *   freeze for the operator.
 * - `policy`: a Ductum budget/turn hard stop — freeze + notify, resumable.
 * - `terminal`: bad request / context overflow — fail with evidence.
 *
 * The classifier is heuristic over `failReason` + `failureEvidence`; a harness
 * may short-circuit it by setting `failureEvidence.category`. Ambiguous
 * failures default to `terminal` (today's behavior — no new retry loops).
 */
export type HarnessOutcomeKind = 'transient' | 'recoverable-external' | 'policy' | 'terminal'

export interface HarnessOutcome {
  kind: HarnessOutcomeKind
  /** Relative wait hint from the provider, in ms, if known. */
  retryAfterMs: number | null
  /** Absolute reset time (ISO) from the provider, if known. */
  resetAt: string | null
  detail: string
}

/** Default ceiling on how long an auto-wait may sleep before resuming. */
export const DEFAULT_MAX_AUTO_WAIT_MS = 15 * 60 * 1000

const RECOVERABLE_EXTERNAL =
  /\b40[123]\b|insufficient[_ ]?(quota|funds|credit|balance)|out[_ ]?of[_ ]?credit|no[_ ]?credit|billing|payment|past[_ ]?due|invalid[_ ]?api[_ ]?key|unauthor|forbidden|expired[_ ]?(key|token|credential)|account[_ ]?(suspend|disabl)/i
const TRANSIENT =
  /\b429\b|\b50[0234]\b|rate[_ ]?limit|too[_ ]?many[_ ]?requests|overloaded|temporar|unavailable|server[_ ]?error|timeout|timed[_ ]?out|ECONN|ETIMEDOUT|ENET|EAI_AGAIN|socket[_ ]?hang|network/i
const TERMINAL =
  /context[_ ]?(length|window|overflow)|prompt[_ ]?overflow|too[_ ]?many[_ ]?tokens|max[_ ]?tokens|maximum[_ ]?context|\b400\b|bad[_ ]?request|invalid[_ ]?request|unsupported|model[_ ]?not[_ ]?found|malformed/i

function readNumber(evidence: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = evidence?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

function readString(evidence: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = evidence?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** Best-effort parse of a "retry after N s/min" hint from free text. */
function parseRetryAfterText(text: string): number | null {
  const match = text.match(/(?:retry|reset|again|wait)[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|minute|minutes)?/i)
  if (match == null) return null
  const amount = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()
  if (unit === 'ms') return amount
  if (unit.startsWith('m')) return amount * 60_000
  return amount * 1_000
}

function retryHints(
  evidence: Record<string, unknown> | undefined,
  text: string,
): { retryAfterMs: number | null; resetAt: string | null } {
  const ms = readNumber(evidence, ['retryAfterMs', 'retry_after_ms'])
  const seconds = readNumber(evidence, ['retryAfterSeconds', 'retry_after_seconds', 'retryAfter', 'retry_after'])
  const resetAt = readString(evidence, ['resetAt', 'reset_at', 'resetTime', 'reset_time'])
  const retryAfterMs = ms ?? (seconds != null ? seconds * 1_000 : parseRetryAfterText(text))
  return { retryAfterMs, resetAt }
}

export function classifyHarnessOutcome(result: HarnessSessionResult): HarnessOutcome {
  if (result.exitReason === 'paused-cost-budget' || result.exitReason === 'paused-max-turns') {
    return { kind: 'policy', retryAfterMs: null, resetAt: null, detail: result.pauseDetail?.detail ?? result.exitReason }
  }

  const reason = result.failReason ?? ''
  const evidence = result.failureEvidence
  const text = `${reason} ${evidence == null ? '' : JSON.stringify(evidence)}`
  const { retryAfterMs, resetAt } = retryHints(evidence, text)

  const explicit = readString(evidence, ['category'])?.toLowerCase()
  const declared: HarnessOutcomeKind | null =
    explicit === 'transient' || explicit === 'recoverable-external' || explicit === 'policy' || explicit === 'terminal'
      ? explicit
      : null

  const kind: HarnessOutcomeKind =
    declared ??
    (RECOVERABLE_EXTERNAL.test(text)
      ? 'recoverable-external'
      : TRANSIENT.test(text)
        ? 'transient'
        : TERMINAL.test(text)
          ? 'terminal'
          : 'terminal')

  return { kind, retryAfterMs, resetAt, detail: reason || result.exitReason }
}

/**
 * Resolve the effective auto-wait (ms) before resuming a transient/near-reset
 * outcome, or null when the wait exceeds the cap (caller fails over / freezes).
 */
export function resolveAutoWaitMs(
  outcome: HarnessOutcome,
  nowMs: number,
  maxWaitMs: number = DEFAULT_MAX_AUTO_WAIT_MS,
): number | null {
  let waitMs = outcome.retryAfterMs
  if (waitMs == null && outcome.resetAt != null) {
    const resetMs = new Date(outcome.resetAt).getTime()
    if (Number.isFinite(resetMs)) waitMs = Math.max(0, resetMs - nowMs)
  }
  if (waitMs == null) return null
  if (waitMs > maxWaitMs) return null
  return waitMs
}
