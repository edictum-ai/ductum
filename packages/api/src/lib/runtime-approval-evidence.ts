import type { CodeReviewResult, Run, VerifyResult } from '@ductum/core'

export function buildRuntimeVerificationEvidencePayload(
  run: Pick<Run, 'commitSha'> | null | undefined,
  result: VerifyResult,
): Record<string, unknown> {
  return withRunCommit(run, {
    kind: 'verify',
    passed: result.passed,
    output: result.output,
  })
}

export function buildRuntimeReviewEvidencePayload(
  run: Pick<Run, 'commitSha'> | null | undefined,
  result: CodeReviewResult,
  commitSha?: string,
): Record<string, unknown> {
  void run
  return withCommit(commitSha, {
    kind: 'internal-review',
    verdict: result.verdict,
    passed: result.passed,
    feedback: result.feedback,
    malformed: result.malformed === true,
  })
}

function withRunCommit(run: Pick<Run, 'commitSha'> | null | undefined, payload: Record<string, unknown>) {
  const commitSha = run?.commitSha?.trim()
  return withCommit(commitSha, payload)
}

function withCommit(commitSha: string | null | undefined, payload: Record<string, unknown>) {
  const trimmed = commitSha?.trim()
  return trimmed == null || trimmed === '' ? payload : { ...payload, commitSha: trimmed }
}
