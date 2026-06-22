import { isRecoverableAgentFailure } from './dispatcher-agent-health.js'

/**
 * Transient-vs-deterministic classifier for retry-budget exhaustion
 * (design/04 §5, RISK 4). Pure function over durable failure state — no DB,
 * no side effects — so it is trivially exhaustively testable.
 *
 * DISTINCT from dispatcher-reconcile-classifier.ts, which classifies STARTUP
 * reconcile dispositions. This one decides only quarantine-vs-fail at the
 * moment a task's retry budget runs out.
 *
 * Bias: when in doubt, classify transient (do not quarantine). A poison task
 * is quarantined only on POSITIVE evidence: the failure is non-recoverable
 * AND it recurred with the same normalized signature across retries.
 */
export type RetryExhaustionClass = 'deterministic' | 'transient'

export interface ClassifyRetryExhaustionInput {
  /** Heartbeat stalls are operational/infra, never task poison. */
  cause: 'crash' | 'heartbeat'
  /** Terminal failure reason for the current attempt. The crash-path caller
   *  persists this to the run BEFORE classifying so recurrence is readable. */
  failReason: string | null | undefined
  /** Fail reasons of the task's PRIOR retry runs (excluding the current run),
   *  read from durable run history. Same normalization is applied. */
  priorFailReasons: ReadonlyArray<string | null | undefined>
  /** Force transient regardless of reason. Provider-backoff / failover
   *  exhaustion is transient by construction (waitAndResume path). */
  forceTransient?: boolean
}

/** Reasons that carry no poison evidence — synthetic placeholders emitted when
 *  no real failure text was captured. Never treat as a recurring signature. */
const SYNTHETIC_PLACEHOLDERS = new Set(['', 'stalled', 'harness_failed', 'run failed', 'failed'])

/**
 * Normalize a failReason for recurrence comparison: lowercase, collapse
 * whitespace, strip volatile suffixes (timestamps, long ids, trailing counts)
 * so the same poison signature matches across retries even when the raw text
 * varies by run id / time.
 */
export function normalizeFailReason(reason: string | null | undefined): string {
  if (reason == null) return ''
  return reason
    .trim()
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z?/g, '')
    .replace(/\b[a-z0-9_-]{16,}\b/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyRetryExhaustion(input: ClassifyRetryExhaustionInput): RetryExhaustionClass {
  if (input.cause === 'heartbeat') return 'transient'
  if (input.forceTransient === true) return 'transient'

  const reason = input.failReason ?? null
  const normalized = normalizeFailReason(reason)
  // Empty / synthetic-placeholder reasons carry no poison evidence.
  if (normalized === '' || SYNTHETIC_PLACEHOLDERS.has(normalized)) return 'transient'
  // Recoverable/provider/infra failures stay transient even when recurring
  // (a repeating auth failure is a configuration issue, not a poison task).
  if (reason != null && isRecoverableAgentFailure(reason)) return 'transient'
  // Deterministic poison = non-recoverable AND the same normalized signature
  // recurred on a prior retry run. First-time non-recoverable stays transient.
  const recurred = input.priorFailReasons.some((prior) => normalizeFailReason(prior) === normalized)
  return recurred ? 'deterministic' : 'transient'
}
