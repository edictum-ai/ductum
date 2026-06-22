import { createHash } from 'node:crypto'

/**
 * Stable content hash for a replayable evidence record, computed over the REDACTED payload so the
 * address commits to exactly what is persisted (never a raw secret). Used to make the evidence write
 * idempotent: a retried write of the identical record for the same run dedups instead of inserting
 * a duplicate or throwing on the primary key (the non-idempotent-INSERT defect).
 */
export function evidenceContentSha(type: string, redactedPayload: unknown): string {
  return createHash('sha256').update(canonicalize({ type, payload: redactedPayload })).digest('hex')
}

export function replayableEvidenceContentSha(type: string, redactedPayload: unknown): string | null {
  return isAppendOnlyOperatorNote(type, redactedPayload) ? null : evidenceContentSha(type, redactedPayload)
}

function isAppendOnlyOperatorNote(type: string, redactedPayload: unknown): boolean {
  if (type !== 'custom' || redactedPayload == null || typeof redactedPayload !== 'object') {
    return false
  }
  const kind = (redactedPayload as Record<string, unknown>).kind
  return kind === 'operator-note' || kind === 'operator.note'
}

/** Deterministic JSON: object keys sorted recursively so structurally-identical values hash equally. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value != null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(obj).sort().map((key) => [key, sortKeys(obj[key])]))
  }
  return value
}
