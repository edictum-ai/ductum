import type { HarnessSessionResult } from './dispatcher-support.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import { createId, type RunId } from './types.js'

export function recordHarnessFailureEvidence(
  evidenceRepo: EvidenceRepo | undefined,
  runId: RunId,
  result: HarnessSessionResult,
): void {
  if (evidenceRepo == null || result.exitReason !== 'failed') return
  const reason = result.failReason ?? 'harness_failed'
  evidenceRepo.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: {
      kind: 'harness.failure',
      reason,
      exitReason: result.exitReason,
      evidence: result.failureEvidence ?? null,
    },
  })
}
