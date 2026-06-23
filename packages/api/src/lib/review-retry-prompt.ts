import { STRUCTURED_REVIEW_CONTRACT_RULE, type Task } from '@ductum/core'

const REFRESH_MARKER = '## Operator Retry Review Contract Refresh'

export function buildOperatorRetryReviewPrompt(task: Task, reason: string): string | null {
  if (!isReviewTask(task)) return null
  if (hasFreshReviewContract(task.prompt)) return null
  return [
    task.prompt,
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

function isReviewTask(task: Task): boolean {
  return task.requiredRole === 'reviewer' || task.strategyRole === 'blind_review'
}

function hasFreshReviewContract(prompt: string): boolean {
  return prompt.includes(REFRESH_MARKER) && prompt.includes('Do not emit a top-level `best-of-n-verdict`')
}
