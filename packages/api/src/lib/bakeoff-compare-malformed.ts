import type { Evidence, Run, Task } from '@ductum/core'

export interface MalformedReviewState {
  reviewCount: number
  recoveryState: string | null
}

export function malformedReviewState(
  reviewTask: Task | null,
  runsForTask: (taskId: Task['id']) => Run[],
  evidenceForRun: (runId: Run['id']) => Evidence[],
): MalformedReviewState {
  if (reviewTask == null) return { reviewCount: 0, recoveryState: null }
  const runs = runsForTask(reviewTask.id)
  let reviewCount = 0
  let recoveryState: string | null = null
  for (const run of runs) {
    let malformed = false
    if (isMalformedReviewReason(run.failReason)) {
      malformed = true
      recoveryState = run.failReason
    }
    for (const evidence of evidenceForRun(run.id)) {
      const payload = evidence.payload as { kind?: string; malformed?: unknown; feedback?: unknown }
      if (payload.kind === 'internal-review' && payload.malformed === true) {
        malformed = true
        if (typeof payload.feedback === 'string') recoveryState = payload.feedback
      }
    }
    if (malformed) reviewCount += 1
  }
  return { reviewCount, recoveryState }
}

function isMalformedReviewReason(reason: string | null | undefined): boolean {
  if (reason == null) return false
  const normalized = reason.toLowerCase()
  return normalized.includes('malformed reviewer completion')
    || normalized.includes('blind review completion is malformed')
    || normalized.includes('requires exactly one structured ductum-review-result json object')
    || normalized.includes('multiple structured ductum-review-result json objects')
    || normalized.includes('ductum-review-result is missing bestofn judge verdict')
    || normalized.includes('structured verdict winnertaskid')
    || normalized.includes('structured verdict score taskid')
    || normalized.includes('structured verdict winner is not eligible')
    || normalized.includes('structured verdict winner is not done')
    || normalized.includes('structured verdict policy mismatch')
}
