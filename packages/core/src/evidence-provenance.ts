export const DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD = 'ductumEvidenceProducer'
export const DUCTUM_RUNTIME_EVIDENCE_PRODUCER = 'ductum.runtime'
export const DUCTUM_WATCHER_EVIDENCE_PRODUCER = 'ductum.watcher'
export const DUCTUM_APPROVAL_EVIDENCE_PRODUCER = 'ductum.approval'

export type DuctumTrustedEvidenceProducer =
  | typeof DUCTUM_RUNTIME_EVIDENCE_PRODUCER
  | typeof DUCTUM_WATCHER_EVIDENCE_PRODUCER
  | typeof DUCTUM_APPROVAL_EVIDENCE_PRODUCER

export function withTrustedEvidenceProducer(
  payload: Record<string, unknown>,
  producer: DuctumTrustedEvidenceProducer,
): Record<string, unknown> {
  return { ...payload, [DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD]: producer }
}

export function isTrustedEvidencePayload(payload: Record<string, unknown>): boolean {
  return payload[DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD] === DUCTUM_RUNTIME_EVIDENCE_PRODUCER ||
    payload[DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD] === DUCTUM_WATCHER_EVIDENCE_PRODUCER ||
    payload[DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD] === DUCTUM_APPROVAL_EVIDENCE_PRODUCER
}
