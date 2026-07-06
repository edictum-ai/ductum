import type { PriorAttemptFailure } from './dispatcher-types.js'
import type { Evidence, Run } from './types.js'

/**
 * Derive the prior attempt failure shape (#282) from a resumable run. Returns
 * null when the run has no usable failure signal (no failReason, no telemetry).
 * Prefer durable ceiling/failure evidence because the run row stores only
 * cumulative tokens. Fall back to the run row when old attempts lack evidence.
 */
export function resolvePriorAttemptFailure(run: Run, evidence: Array<Pick<Evidence, 'payload'>> = []): PriorAttemptFailure | null {
  const evidenceFailure = resolvePriorAttemptFailureFromEvidence(run, evidence)
  if (evidenceFailure != null) return evidenceFailure

  const failReason = run.failReason?.trim()
  if (failReason == null || failReason === '') return null
  if (run.tokensIn <= 0 && run.costUsd <= 0) return null
  return {
    failReason,
    tokensIn: Math.max(0, run.tokensIn),
    maxInputTokensInTurn: Math.max(0, run.tokensIn),
    turns: 0,
  }
}

function resolvePriorAttemptFailureFromEvidence(run: Run, evidence: Array<Pick<Evidence, 'payload'>>): PriorAttemptFailure | null {
  for (const item of [...evidence].reverse()) {
    const payload = item.payload
    const resourceCeiling = fromResourceCeilingEvidence(run, payload)
    if (resourceCeiling != null) return resourceCeiling
    const harnessFailure = fromHarnessFailureEvidence(run, payload)
    if (harnessFailure != null) return harnessFailure
  }
  return null
}

function fromResourceCeilingEvidence(run: Run, payload: Record<string, unknown>): PriorAttemptFailure | null {
  if (payload.kind !== 'attempt.resource_ceiling') return null
  const ceiling = stringValue(payload.ceiling)
  if (ceiling !== 'maxInputTokensPerTurn') return null
  const telemetry = recordValue(payload.observedTelemetry)
  const observed = numberValue(payload.observed)
  const maxInputTokensInTurn = numberValue(telemetry?.maxInputTokensInTurn) ?? observed
  if (maxInputTokensInTurn == null) return null
  return {
    failReason: run.failReason?.trim() || stringValue(telemetry?.failReason) || ceiling,
    tokensIn: numberValue(telemetry?.tokensIn) ?? Math.max(0, run.tokensIn),
    maxInputTokensInTurn,
    turns: numberValue(telemetry?.turns) ?? 0,
  }
}

function fromHarnessFailureEvidence(run: Run, payload: Record<string, unknown>): PriorAttemptFailure | null {
  if (payload.kind !== 'harness.failure') return null
  const evidence = recordValue(payload.evidence)
  const observed = recordValue(evidence?.observedContext)
  const maxInputTokensInTurn = numberValue(observed?.maxInputTokensInTurn)
  const tokensIn = numberValue(observed?.tokensIn)
  if (maxInputTokensInTurn == null && tokensIn == null) return null
  const reason = stringValue(payload.reason) ?? stringValue(evidence?.reason) ?? stringValue(evidence?.kind)
  return {
    failReason: run.failReason?.trim() || reason || 'harness_failed',
    tokensIn: tokensIn ?? Math.max(0, run.tokensIn),
    maxInputTokensInTurn: maxInputTokensInTurn ?? tokensIn ?? Math.max(0, run.tokensIn),
    turns: numberValue(observed?.turns) ?? 0,
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
