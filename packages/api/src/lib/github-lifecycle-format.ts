import type { Evidence, GitHubIssueSource, Run, Spec, Task } from '@ductum/core'

export function conventionalTypeForSource(spec: Spec, task: Task): string {
  const source = resolveGitHubIssueSource(spec, task)
  const workType = source != null && 'parsed' in source ? source.parsed.workType : ''
  switch (workType) {
    case 'bug':
    case 'security':
      return 'fix'
    case 'docs':
      return 'docs'
    case 'cleanup':
    case 'migration':
    case 'distribution':
      return 'chore'
    default:
      return 'feat'
  }
}

export function resolveConventionalBranchName(spec: Spec, task: Task, repositoryBranchPrefix?: string): string {
  const source = resolveGitHubIssueSource(spec, task)
  const suggested = source != null && 'parsed' in source ? source.parsed.suggestedBranch : null
  if (suggested != null && suggested.trim() !== '') return suggested.trim()
  const prefix = cleanBranchPrefix(repositoryBranchPrefix) ?? `${conventionalTypeForSource(spec, task)}/`
  return `${prefix}${sanitizeGitRefSegment(task.name)}`
}

export function buildConventionalPrTitle(spec: Spec, task: Task): string {
  const source = resolveGitHubIssueSource(spec, task)
  const titleSource = source?.title ?? task.name
  return `${conventionalTypeForSource(spec, task)}: ${titleSource}`
}

export function buildGitHubPrBody(input: {
  spec: Spec
  task: Task
  run: Run
  branch: string
  verificationEvidence: Evidence | null
}): string {
  const source = resolveGitHubIssueSource(input.spec, input.task)
  const verificationStatus = describeVerification(input.task, input.verificationEvidence)
  return [
    '## Summary',
    source == null ? `- Task: ${input.task.name}` : `- Source issue: ${source.issueUrl} (${source.repoOwner}/${source.repoName}#${source.issueNumber})`,
    `- Branch: ${input.branch}`,
    `- Attempt: ${input.run.id}`,
    '',
    '## Verification',
    ...verificationStatus.map((line) => `- ${line}`),
    '',
    '## Approval',
    `- Operator approval: ${input.run.pendingApproval ? 'pending' : 'not yet open'}`,
    `- Linked PR provenance: ${input.run.prUrl == null ? 'creating or updating now' : input.run.prUrl}`,
    ...(source == null || !('promptImport' in source) ? [] : [
      '',
      '## Prompt import',
      `- Prompt digest: ${source.promptImport.promptDigest}`,
      `- Implementation prompt source: ${source.promptImport.implementation.sourceUrl}`,
      `- Review prompt source: ${source.promptImport.review.sourceUrl}`,
    ]),
    ...(source == null || !('parsed' in source) ? [] : [
      '',
      '## Evidence',
      ...source.parsed.evidence.map((line: string) => `- ${line}`),
    ]),
  ].join('\n')
}

function resolveGitHubIssueSource(spec: Spec, task: Task): GitHubIssueSource | null {
  if (task.source?.kind === 'github-issue') return task.source
  if (spec.source?.kind === 'github-issue') return spec.source
  return null
}

function describeVerification(task: Task, evidence: Evidence | null): string[] {
  const commands = task.verification.length === 0 ? ['No verification commands recorded'] : task.verification
  const passed = evidence?.payload.passed === true
  const hasEvidence = evidence != null
  return commands.map((command) => {
    if (!hasEvidence) return `${command} (missing evidence)`
    return `${command} (${passed ? 'passed' : 'failed'})`
  })
}

function cleanBranchPrefix(value: string | undefined): string | undefined {
  if (value == null) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function sanitizeGitRefSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task'
}
