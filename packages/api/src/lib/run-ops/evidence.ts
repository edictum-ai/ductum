import { createId, type Evidence, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { requireRun } from './common.js'

export function addEvidence(
  context: ApiContext,
  runId: RunId,
  type: Evidence['type'],
  payload: Record<string, unknown>,
) {
  requireRun(context, runId)
  const evidence = context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type,
    payload,
  })
  context.events.emit({ type: 'run.evidence_attached', runId, evidenceId: evidence.id })
  return evidence
}

export function parseGateEvidence(
  runId: RunId,
  evidence: Array<{ id?: string; type: Evidence['type']; payload: Record<string, unknown> }>,
): Evidence[] {
  return evidence.map((item) => ({
    id: (item.id ?? createId<'EvidenceId'>()) as Evidence['id'],
    runId,
    type: item.type,
    payload: item.payload,
    createdAt: new Date().toISOString(),
  }))
}
