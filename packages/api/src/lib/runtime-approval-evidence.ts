import {
  DUCTUM_RUNTIME_EVIDENCE_PRODUCER,
  withTrustedEvidenceProducer,
  type CodeReviewResult,
  type Run,
  type VerifyResult,
} from '@ductum/core'

export function buildRuntimeVerificationEvidencePayload(
  run: Pick<Run, 'commitSha'> | null | undefined,
  result: VerifyResult,
): Record<string, unknown> {
  return withRunCommit(run, {
    kind: 'verify',
    passed: result.passed,
    output: result.output,
    commands: (result.commands ?? []).map((item) => ({
      command: item.command,
      passed: item.passed,
      output: item.output,
    })),
  })
}

export function buildRuntimeReviewEvidencePayload(
  result: CodeReviewResult,
  commitSha?: string,
): Record<string, unknown> {
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
  const stamped = trimmed == null || trimmed === '' ? payload : { ...payload, commitSha: trimmed }
  return withTrustedEvidenceProducer(stamped, DUCTUM_RUNTIME_EVIDENCE_PRODUCER)
}
