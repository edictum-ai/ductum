import type { HarnessSessionResult } from './dispatcher-support.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import type { FencingToken } from './attempt-lease.js'
import { createId, type RunId } from './types.js'

export function recordHarnessFailureEvidence(
  evidenceRepo: EvidenceRepo | undefined,
  runId: RunId,
  result: HarnessSessionResult,
  fenceToken?: FencingToken,
  fenceNow?: Date,
): void {
  if (evidenceRepo == null || result.exitReason !== 'failed') return
  const reason = result.failReason ?? 'harness_failed'
  const evidence = {
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: {
      kind: 'harness.failure',
      reason,
      exitReason: result.exitReason,
      evidence: result.failureEvidence ?? null,
    },
  } as const
  if (fenceToken != null && evidenceRepo.createFenced != null) evidenceRepo.createFenced(evidence, fenceToken, fenceNow)
  else evidenceRepo.create(evidence)
}
