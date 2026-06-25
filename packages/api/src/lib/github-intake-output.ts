import { isGitHubIssuePromptSource, type GitHubIssuePromptSource, type GitHubIssueSource, type Spec, type Task } from '@ductum/core'

export function buildSpecDocument(source: GitHubIssueSource): string {
  if (isGitHubIssuePromptSource(source)) {
    return [
      `Imported from GitHub issue ${source.issueUrl}`,
      '',
      `Labels: ${source.labels.join(', ') || '(none)'}`,
      `Prompt digest: ${source.promptImport.promptDigest}`,
      `Implementation prompt source: ${formatPromptSectionSource(source.promptImport.implementation)}`,
      `Review prompt source: ${formatPromptSectionSource(source.promptImport.review)}`,
      '',
      'This spec was created from explicit GitHub prompt sections.',
    ].join('\n')
  }
  return [
    `Imported from GitHub issue ${source.issueUrl}`,
    '',
    `Labels: ${source.labels.join(', ') || '(none)'}`,
    '',
    source.parsed.objective,
  ].join('\n')
}

export function buildTaskPrompt(source: GitHubIssueSource): string {
  if (isGitHubIssuePromptSource(source)) {
    return [
      '## GitHub issue source',
      `- Issue: ${source.issueUrl}`,
      `- Title: ${source.title}`,
      `- Labels: ${source.labels.join(', ') || '(none)'}`,
      `- Prompt digest: ${source.promptImport.promptDigest}`,
      `- Implementation prompt source: ${formatPromptSectionSource(source.promptImport.implementation)}`,
      `- Review prompt source: ${formatPromptSectionSource(source.promptImport.review)} (kept out of this implementer task and routed only to review)`,
      '',
      `## ${source.promptImport.implementation.heading}`,
      source.promptImport.implementation.body,
    ].join('\n')
  }
  return [
    '## GitHub issue source',
    `- Issue: ${source.issueUrl}`,
    `- Title: ${source.title}`,
    `- Labels: ${source.labels.join(', ') || '(none)'}`,
    `- Work type: ${source.parsed.workType}`,
    `- Priority: ${source.parsed.priority}`,
    `- Area: ${source.parsed.area}`,
    `- Blockers: ${source.parsed.blockers.join(', ') || '(none)'}`,
    '',
    '## Objective',
    source.parsed.objective,
    '',
    '## Evidence and source refs',
    ...source.parsed.evidence.map((line) => `- ${line}`),
    '',
    '## Requirements',
    ...source.parsed.requirements.map((line) => `- ${line}`),
    '',
    '## Out of scope',
    ...source.parsed.outOfScope.map((line) => `- ${line}`),
    '',
    '## Acceptance criteria',
    ...source.parsed.acceptanceCriteria.map((line) => `- ${line}`),
    '',
    '## Safety and rollback notes',
    ...source.parsed.safetyNotes.map((line) => `- ${line}`),
    ...(source.parsed.suggestedBranch == null ? [] : ['', `Suggested branch: ${source.parsed.suggestedBranch}`]),
    ...(source.parsed.ductumHints == null ? [] : ['', '## Ductum executor hints', source.parsed.ductumHints]),
  ].join('\n')
}

export function resolveVerificationCommands(source: GitHubIssueSource): string[] {
  return isGitHubIssuePromptSource(source) ? [] : source.parsed.verificationCommands
}

export function buildResult(source: GitHubIssueSource, spec: Spec, task: Task, disposition: 'created' | 'unchanged') {
  return {
    recordType: 'GitHubIssueIntake' as const,
    import: {
      disposition,
      mode: isGitHubIssuePromptSource(source) ? 'prompt-sections' : 'issue-form',
      promptDigest: isGitHubIssuePromptSource(source) ? source.promptImport.promptDigest : null,
      reviewPrompt: isGitHubIssuePromptSource(source)
        ? { routedToTask: source.promptImport.reviewPromptRoutedToTask, source: formatPromptSectionSource(source.promptImport.review) }
        : null,
    },
    issue: {
      url: source.issueUrl,
      title: source.title,
      number: source.issueNumber,
      labels: source.labels,
      repository: `${source.repoOwner}/${source.repoName}`,
    },
    spec,
    task,
  }
}

function formatPromptSectionSource(section: GitHubIssuePromptSource['promptImport']['implementation']): string {
  return section.sourceKind === 'issue-body'
    ? `issue body (${section.sourceUrl})`
    : `issue comment (${section.commentUrl ?? section.sourceUrl})`
}
