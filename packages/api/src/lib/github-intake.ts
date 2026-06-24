import { createId, type GitHubIssueSource, type Project, type Repository } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'
import { fetchGitHubIssue } from './github-client.js'
import { resolveGitHubReadAuth } from './github-auth.js'
import { parseDuctumIssueForm } from './github-issue-form.js'
import { parseGitHubIssueRef, parseGitHubRepoRef, toGitHubApiBaseUrl } from './github-ref.js'
import { repositoryLegacyRef } from './repositories.js'

export interface GitHubIssueIntakeInput {
  projectId?: string
  projectName?: string
  repositoryId?: string
  issueRef: string
}

export function resolveGitHubIssueProject(context: ApiContext, input: GitHubIssueIntakeInput): Project {
  const project = input.projectId == null
    ? context.repos.projects.getByName(input.projectName ?? '')
    : context.repos.projects.get(input.projectId as never)
  if (project == null) throw new NotFoundError(`Project not found: ${input.projectId ?? input.projectName}`)
  return project
}

export async function intakeGitHubIssue(context: ApiContext, input: GitHubIssueIntakeInput) {
  const project = resolveGitHubIssueProject(context, input)
  const repositoryScope = resolveExplicitRepository(context, project.id, input.repositoryId)
  const fallbackRepo = repositoryScope == null ? inferFallbackRepo(context, project.id) : parseRepositoryGitHubRef(repositoryScope)
  const issueRef = parseGitHubIssueRef(input.issueRef, fallbackRepo)
  const repository = resolveScopedRepository(context, project.id, repositoryScope, issueRef.owner, issueRef.repo)
  const auth = await resolveGitHubReadAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    apiBaseUrl: toGitHubApiBaseUrl(issueRef),
  })
  const issue = await fetchGitHubIssue(issueRef, auth.token)
  const parsed = parseDuctumIssueForm(issue.body)
  const source = buildSource(issue, issueRef.owner, issueRef.repo, parsed, context.now().toISOString())

  const spec = context.repos.specs.create({
    id: createId<'SpecId'>(),
    projectId: project.id,
    name: issue.title,
    status: 'approved',
    document: buildSpecDocument(source),
    maxFixIterations: null,
    source,
  })
  const task = context.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: repository.id,
    targetId: null,
    componentId: null,
    name: issue.title,
    prompt: buildTaskPrompt(source),
    repos: [repositoryLegacyRef(repository)],
    source,
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'pending',
    verification: source.parsed.verificationCommands,
  })
  context.dag.evaluateTaskDAG(spec.id)
  return {
    recordType: 'GitHubIssueIntake',
    issue: {
      url: source.issueUrl,
      title: source.title,
      number: source.issueNumber,
      labels: source.labels,
      repository: `${source.repoOwner}/${source.repoName}`,
    },
    spec: context.repos.specs.get(spec.id) ?? spec,
    task: context.repos.tasks.get(task.id) ?? task,
  }
}

function resolveExplicitRepository(context: ApiContext, projectId: string, repositoryId?: string): Repository | null {
  if (repositoryId == null) return null
  const repository = context.repos.repositories.get(repositoryId as never)
  if (repository == null) throw new NotFoundError(`Repository not found: ${repositoryId}`)
  if (repository.projectId !== projectId) throw new ValidationError('Issue intake repository must belong to the same project')
  return repository
}

function inferFallbackRepo(context: ApiContext, projectId: string) {
  const repositories = context.repos.repositories.list(projectId as never)
  if (repositories.length !== 1) return null
  return parseRepositoryGitHubRef(repositories[0]!)
}

function resolveScopedRepository(
  context: ApiContext,
  projectId: string,
  explicitRepository: Repository | null,
  owner: string,
  repo: string,
): Repository {
  if (explicitRepository != null) {
    assertRepositoryMatchesIssue(explicitRepository, owner, repo)
    return explicitRepository
  }
  const repositories = context.repos.repositories.list(projectId as never)
  const matched = repositories.filter((candidate) => {
    const parsed = parseRepositoryGitHubRef(candidate)
    return parsed != null
      && parsed.owner.toLowerCase() === owner.toLowerCase()
      && parsed.repo.toLowerCase() === repo.toLowerCase()
  })
  if (matched.length === 1) return matched[0]!
  if (repositories.length === 1) {
    assertRepositoryMatchesIssue(repositories[0]!, owner, repo)
    return repositories[0]!
  }
  throw new ValidationError(`Could not infer a repository for GitHub issue ${owner}/${repo}; pass repositoryId`)
}

function assertRepositoryMatchesIssue(repository: Repository, owner: string, repo: string): void {
  const parsed = parseRepositoryGitHubRef(repository)
  if (parsed == null) return
  if (parsed.owner.toLowerCase() !== owner.toLowerCase() || parsed.repo.toLowerCase() !== repo.toLowerCase()) {
    throw new ValidationError(`Repository ${repository.name} does not match GitHub issue repository ${owner}/${repo}`)
  }
}

function parseRepositoryGitHubRef(repository: Repository) {
  const remoteUrl = repository.spec.remoteUrl?.trim()
  return remoteUrl == null || remoteUrl === '' ? null : parseGitHubRepoRef(remoteUrl)
}

function buildSource(
  issue: Awaited<ReturnType<typeof fetchGitHubIssue>>,
  owner: string,
  repo: string,
  parsed: GitHubIssueSource['parsed'],
  importedAt: string,
): GitHubIssueSource {
  return {
    kind: 'github-issue',
    provider: 'github',
    repoOwner: owner,
    repoName: repo,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    title: issue.title,
    labels: issue.labels.map((label) => typeof label === 'string' ? label : label.name ?? '').filter((label) => label !== ''),
    importedAt,
    formId: 'ductum-work-item',
    parsed,
  }
}

function buildSpecDocument(source: GitHubIssueSource): string {
  return [
    `Imported from GitHub issue ${source.issueUrl}`,
    '',
    `Labels: ${source.labels.join(', ') || '(none)'}`,
    '',
    source.parsed.objective,
  ].join('\n')
}

function buildTaskPrompt(source: GitHubIssueSource): string {
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
