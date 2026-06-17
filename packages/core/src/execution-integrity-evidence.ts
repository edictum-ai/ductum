import type { Evidence } from './types.js'

const RECONCILE_LINEAGE_REASONS = new Set(['merged', 'approval_lineage'])

export function findOutcome(
  evidence: readonly Evidence[],
  kind: string,
  isValid: (value: unknown) => value is string,
): string | null {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const item = evidence[index]!
    if (item.type !== 'custom') continue
    if (item.payload.kind !== kind) continue
    const outcome = item.payload.outcome
    if (isValid(outcome)) return outcome
  }
  return null
}

export function hasInvalidOutcome(
  evidence: readonly Evidence[],
  kind: string,
  isValid: (value: unknown) => value is string,
): boolean {
  return evidence.some((item) =>
    item.type === 'custom' &&
    item.payload.kind === kind &&
    !isValid(item.payload.outcome),
  )
}

export function hasReconciledCompletionLineage(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) =>
    item.type === 'custom' &&
    item.payload.kind === 'state-reconcile' &&
    typeof item.payload.reason === 'string' &&
    RECONCILE_LINEAGE_REASONS.has(item.payload.reason),
  )
}

export function hasBulkImportedRecordedEvidence(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) =>
    item.type === 'custom' &&
    item.payload.kind === 'bulk-import-shipped-spec',
  )
}

export function hasStructuredFinalEvidence(evidence: readonly Evidence[]): boolean {
  return evidence.some(isStructuredFinalEvidenceItem)
}

export function hasStructuredCompletionEvidence(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => {
    const payload = item.payload
    if (payload.passed === true && ['ci', 'review', 'test', 'lint'].includes(item.type)) return true
    if (item.type !== 'custom') return false
    if (payload.kind === 'verify') return payload.passed === true
    if (payload.kind === 'internal-review') {
      return payload.passed === true || payload.verdict === 'pass' || payload.verdict === 'warn' || payload.verdict === 'fail'
    }
    return isStructuredFinalEvidenceItem(item)
  })
}

export function hasProseSuccessSignal(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => {
    if (item.type !== 'custom') return false
    if (
      item.payload.kind === 'external-outcome' ||
      item.payload.kind === 'bakeoff-candidate-outcome' ||
      item.payload.kind === 'bulk-import-shipped-spec' ||
      item.payload.kind === 'state-reconcile' ||
      item.payload.kind === 'verify' ||
      item.payload.kind === 'internal-review'
    ) return false
    if (isStructuredFinalEvidenceItem(item)) return false
    return customPayloadHasSuccessSignal(item.payload)
  })
}

export function customPayloadHasSuccessSignal(value: unknown): boolean {
  if (typeof value === 'string') {
    if (/\bFAIL(?:ED)?\b/i.test(value)) return false
    return /^\s*(PASS|all tests passed|verification passed|review passed)\b/i.test(value)
  }
  if (Array.isArray(value)) return value.some(customPayloadHasSuccessSignal)
  if (value == null || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).some(customPayloadHasSuccessSignal)
}

function isStructuredFinalEvidenceItem(item: Evidence): boolean {
  const payload = item.payload
  if (item.type !== 'custom') return false
  if (payload.kind === 'internal-review') {
    return payload.passed === true || payload.verdict === 'pass'
  }
  return false
}
