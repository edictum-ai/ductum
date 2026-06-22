import { createId, type Evidence, type FencingToken, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { requireRun } from './common.js'

export function addEvidence(
  context: ApiContext,
  runId: RunId,
  type: Evidence['type'],
  payload: Record<string, unknown>,
  fenceToken?: FencingToken,
) {
  const run = requireRun(context, runId)
  const enrichedPayload = shouldAddRunCommit(run.commitSha, payload)
    ? { ...payload, commitSha: run.commitSha }
    : payload
  const input = {
    id: createId<'EvidenceId'>(),
    runId,
    type,
    payload: enrichedPayload,
  }
  const evidence = fenceToken != null && context.repos.evidence.createFenced != null
    ? context.repos.evidence.createFenced(input, fenceToken, context.now())
    : context.repos.evidence.create(input)
  context.events.emit({ type: 'run.evidence_attached', runId, evidenceId: evidence.id })
  return evidence
}

function shouldAddRunCommit(commitSha: string | null, payload: Record<string, unknown>): boolean {
  return commitSha != null
    && payload.commitSha == null
    && payload.kind !== 'internal-review'
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
