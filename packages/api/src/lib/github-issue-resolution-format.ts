/**
 * P1 #243: closeout comment formatter for the operator-driven
 * `ductum issue close` path. Distinct from the issue-sync comment so the
 * "imported issue / opened PR" comment is preserved separately from the
 * "merged + closed" comment.
 *
 * The body intentionally avoids fenced blocks (the issue-sync formatter
 * learned not to render verify commands as fenced markdown), so a stale
 * closeout refresh never republishes commands back to the issue.
 */

export interface GitHubIssueCloseoutCommentInput {
  runId: string
  prNumber: number
  prUrl: string
  headSha: string
  mergeCommitSha: string
  requiredChecksSource: string | null
  operatorAction: string | null
  actor: { type: string; label: string }
}

export function buildGitHubIssueCloseoutComment(input: GitHubIssueCloseoutCommentInput): string {
  const operatorAction = input.operatorAction == null ? '' : input.operatorAction.trim()
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
    ...(operatorAction === '' ? [] : [`- Operator action: ${operatorAction}`]),
    `- GitHub App actor: ${input.actor.label} (${input.actor.type})`,
  ].join('\n')
}
