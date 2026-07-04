/**
 * P1 #243: closeout comment formatter for the operator-driven
 * `ductum issue close` path. Distinct from the issue-sync comment so the
 * "imported issue / opened PR" comment is preserved separately from the
 * "merged + closed" comment.
 *
 * The body intentionally avoids fenced blocks (the issue-sync formatter
 * learned not to render verify commands as fenced markdown), so a stale
 * closeout refresh never republishes commands back to the issue.
 *
 * Review round 4: the comment must include the actual observed check
 * evidence (names + statuses + conclusions), not just the
 * requiredChecksSource label, so a reader can audit the closeout without
 * leaving the issue thread.
 */

export interface GitHubIssueCloseoutObservedCheck {
  name: string
  status: string
  conclusion: string | null
}

export interface GitHubIssueCloseoutCommentInput {
  runId: string
  prNumber: number
  prUrl: string
  headSha: string
  mergeCommitSha: string
  requiredChecksSource: string | null
  requiredChecks: string[]
  observedChecks: GitHubIssueCloseoutObservedCheck[]
  operatorAction: string | null
  actor: { type: string; label: string }
}

function formatObservedCheck(check: GitHubIssueCloseoutObservedCheck): string {
  const conclusion = check.conclusion == null ? 'unknown' : check.conclusion
  return `${check.name} (${check.status}/${conclusion})`
}

export function buildGitHubIssueCloseoutComment(input: GitHubIssueCloseoutCommentInput): string {
  const operatorAction = input.operatorAction == null ? '' : input.operatorAction.trim()
  const requiredChecksLine = input.requiredChecks.length > 0
    ? input.requiredChecks.join(', ')
    : '(none)'
  const observedChecksLine = input.observedChecks.length > 0
    ? input.observedChecks.map(formatObservedCheck).join(', ')
    : '(none)'
  return [
    `<!-- ductum:github-issue-resolution:${input.runId} -->`,
    'Ductum is closing this issue after a merged run.',
    '',
    `- Run: \`${input.runId}\``,
    `- PR: #${input.prNumber} ${input.prUrl}`,
    `- Head SHA: \`${input.headSha}\``,
    `- Merge commit: \`${input.mergeCommitSha}\``,
    ...(input.requiredChecksSource == null || input.requiredChecksSource === ''
      ? []
      : [`- Required checks source: ${input.requiredChecksSource}`]),
    `- Required checks: ${requiredChecksLine}`,
    `- Observed checks: ${observedChecksLine}`,
    ...(operatorAction === '' ? [] : [`- Operator action: ${operatorAction}`]),
    `- GitHub App actor: ${input.actor.label} (${input.actor.type})`,
  ].join('\n')
}
