import {
  classifyCiChecks,
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  hasCurrentCommitRemoteCiPass,
  withTrustedEvidenceProducer,
  type Run,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { addEvidence } from './evidence.js'
import { fetchCurrentPrHeadCiChecks } from './pr-ci.js'

export async function ensureCurrentPrHeadRemoteCiEvidence(
  context: ApiContext,
  run: Run,
  currentPrHeadSha: string,
): Promise<Run> {
  const existing = context.repos.evidence.list(run.id)
  if (hasCurrentCommitRemoteCiPass(run, existing)) return run

  const checks = await fetchCurrentPrHeadCiChecks(context, run, currentPrHeadSha).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error)
    context.repos.runUpdates.create(run.id, `approval CI evidence snapshot failed: ${detail}`)
    return null
  })
  if (classifyCiChecks(checks) !== 'pass') return run

  addEvidence(context, run.id, 'ci', withTrustedEvidenceProducer({
    passed: true,
    checks,
    commitSha: currentPrHeadSha,
    resolvedAt: context.now().toISOString(),
    source: 'github_pr_approval_snapshot',
  }, DUCTUM_APPROVAL_EVIDENCE_PRODUCER))
  context.repos.runUpdates.create(run.id, `approval recorded current PR head CI evidence for ${currentPrHeadSha}`)
  return context.repos.runs.updateLatchStatus(run.id, 'ciStatus', 'pass')
}
