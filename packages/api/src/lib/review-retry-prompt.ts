import { STRUCTURED_REVIEW_CONTRACT_RULE, type Task } from '@ductum/core'

const REFRESH_MARKER = '## Operator Retry Review Contract Refresh'
const OPERATOR_RETRY_MARKER = '## Operator Retry Context'

export function buildOperatorRetryReviewPrompt(task: Task, reason: string): string | null {
  if (!isReviewTask(task)) return null
  if (hasFreshReviewContract(task.prompt)) return null
  return [
    stripOperatorRetryContext(task.prompt),
    '',
    REFRESH_MARKER,
    'Previous attempt failed before routing:',
    reason,
    '',
    'For this retry, ignore older instructions that mention `best-of-n-verdict`.',
    'Call `ductum_complete` with exactly one JSON object matching the current contract:',
    STRUCTURED_REVIEW_CONTRACT_RULE,
    'For Best-of-N, put winnerTaskId, scores, policy, and reason under `bestOfN`.',
    'Do not emit a top-level `best-of-n-verdict` object, fenced prose, or alternate verdict.',
  ].filter((line) => line.trim() !== '').join('\n')
}

/**
 * Issue #243: operator retry context injection for implementation tasks.
 *
 * Retry reason/context must be included in the implementation prompt so the
 * next attempt can read what the operator observed. Repeated retries must
 * replace the prior retry block instead of stacking stale ones — the helper
 * strips any existing `## Operator Retry Context` section before appending
 * the new one.
 *
 * Returns null when the task already carries a fresh operator retry block
 * with the same reason (so re-retrying with no new info doesn't churn the
 * prompt).
 */
export function buildOperatorRetryPrompt(task: Task, reason: string): string | null {
  if (isReviewTask(task)) return null
  const trimmed = reason.trim()
  if (trimmed === '') return null
  if (hasFreshOperatorRetryContext(task.prompt, trimmed)) return null
  return [
    stripOperatorRetryContext(task.prompt),
    '',
    OPERATOR_RETRY_MARKER,
    `Reason: ${trimmed}`,
    '',
    'Address the operator-reported issue above. Do not repeat work that the operator already rejected.',
  ].join('\n')
}

function isReviewTask(task: Task): boolean {
  return task.requiredRole === 'reviewer' || task.strategyRole === 'blind_review'
}

function hasFreshReviewContract(prompt: string): boolean {
  return prompt.includes(REFRESH_MARKER) && prompt.includes('Do not emit a top-level `best-of-n-verdict`')
}

function hasFreshOperatorRetryContext(prompt: string, reason: string): boolean {
  if (!prompt.includes(OPERATOR_RETRY_MARKER)) return false
  return prompt.includes(`Reason: ${reason}`)
}

function stripOperatorRetryContext(prompt: string): string {
  const start = prompt.indexOf(OPERATOR_RETRY_MARKER)
  if (start === -1) return prompt.trimEnd()
  const before = prompt.slice(0, start).trimEnd()
  return before
}
