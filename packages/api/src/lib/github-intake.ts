import {
  createId,
  isGitHubIssuePromptSource,
  type GitHubIssueFormSource,
  type GitHubIssueSource,
  type Project,
  type Repository,
  type Spec,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'
import { fetchGitHubIssue, fetchGitHubIssueComments } from './github-client.js'
import { resolveGitHubReadAuth } from './github-auth.js'
import { looksLikeDuctumIssueForm, parseDuctumIssueForm } from './github-issue-form.js'
import { buildLegacyGitHubIssueParsedFields } from './github-issue-legacy.js'
import { buildPromptImportSource } from './github-issue-prompts.js'
import { parseGitHubIssueRef, parseGitHubRepoRef, toGitHubApiBaseUrl } from './github-ref.js'
import { buildResult, buildSpecDocument, buildTaskPrompt, resolveVerificationCommands } from './github-intake-output.js'
import { repositoryLegacyRef } from './repositories.js'

export interface GitHubIssueIntakeInput {
  projectId?: string
  projectName?: string
  repositoryId?: string
  issueRef: string
  promptCommentUrls?: string[]
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
  const auth = await resolveGitHubReadAuth({ factoryDir: context.factoryDataDir ?? process.cwd(), repository, secrets: context.repos.secrets, apiBaseUrl: toGitHubApiBaseUrl(issueRef) })
  const issue = await fetchGitHubIssue(issueRef, auth.token)
  const promptCommentUrls = input.promptCommentUrls ?? []
  const comments = promptCommentUrls.length > 0 ? await fetchGitHubIssueComments(issueRef, auth.token) : []
  const source = resolveIssueSource({ issue, comments, owner: issueRef.owner, repo: issueRef.repo, importedAt: context.now().toISOString(), promptCommentUrls })

  const existing = findExistingImportedWork(context, project.id, source)
  if (existing != null) return buildResult(source, existing.spec, existing.task, existing.disposition)

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
    verification: resolveVerificationCommands(source),
  })
  context.dag.evaluateTaskDAG(spec.id)
  return buildResult(source, context.repos.specs.get(spec.id) ?? spec, context.repos.tasks.get(task.id) ?? task, 'created')
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
    return parsed != null && parsed.owner.toLowerCase() === owner.toLowerCase() && parsed.repo.toLowerCase() === repo.toLowerCase()
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

function resolveIssueSource(input: {
  issue: Awaited<ReturnType<typeof fetchGitHubIssue>>
  comments: Awaited<ReturnType<typeof fetchGitHubIssueComments>>
  owner: string
  repo: string
  importedAt: string
  promptCommentUrls: string[]
}): GitHubIssueSource {
  const promptSource = buildPromptImportSource({
    issue: input.issue,
    comments: input.comments,
    owner: input.owner,
    repo: input.repo,
    importedAt: input.importedAt,
    reviewPromptRoutedToTask: true,
    promptCommentUrls: input.promptCommentUrls,
  })
  if (promptSource != null) return promptSource
  return buildFormSource(
    input.issue,
    input.owner,
    input.repo,
    resolveParsedIssueFields(input.issue.body, input.issue.title, input.issue.labels.map((label) => typeof label === 'string' ? label : label.name ?? '')),
    input.importedAt,
  )
}

function resolveParsedIssueFields(
  body: string,
  title: string,
  labels: string[],
): GitHubIssueFormSource['parsed'] {
  try {
    return parseDuctumIssueForm(body)
  } catch (error) {
    if (!(error instanceof ValidationError) || looksLikeDuctumIssueForm(body)) throw error
    const parsed = buildLegacyGitHubIssueParsedFields({ body, title, labels: labels.filter((label) => label !== '') })
    if (parsed != null) return parsed
    throw error
  }
}

function buildFormSource(
  issue: Awaited<ReturnType<typeof fetchGitHubIssue>>,
  owner: string,
  repo: string,
  parsed: GitHubIssueFormSource['parsed'],
  importedAt: string,
): GitHubIssueFormSource {
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

function findExistingImportedWork(
  context: ApiContext,
  projectId: string,
  source: GitHubIssueSource,
): { spec: Spec; task: Task; disposition: 'unchanged' } | null {
  for (const spec of context.repos.specs.list(projectId as never)) {
    if (!matchesIssue(spec.source, source)) continue
    const task = context.repos.tasks.list(spec.id).find((candidate) => matchesIssue(candidate.source, source))
    if (task == null) continue
    assertReimportCompatible(spec.source ?? null, source, spec.id, task.id)
    return { spec, task, disposition: 'unchanged' }
  }
  return null
}

function matchesIssue(existing: GitHubIssueSource | null | undefined, incoming: GitHubIssueSource): boolean {
  return existing?.kind === 'github-issue'
    && existing.repoOwner === incoming.repoOwner
    && existing.repoName === incoming.repoName
    && existing.issueNumber === incoming.issueNumber
}

function assertReimportCompatible(existing: GitHubIssueSource | null, incoming: GitHubIssueSource, specId: string, taskId: string): void {
  if (existing == null) return
  if (isGitHubIssuePromptSource(existing) && isGitHubIssuePromptSource(incoming)) {
    if (existing.promptImport.promptDigest !== incoming.promptImport.promptDigest) {
      throw new ValidationError(`GitHub issue prompt import changed for ${incoming.repoOwner}/${incoming.repoName}#${incoming.issueNumber}; existing spec ${specId} task ${taskId} has digest ${existing.promptImport.promptDigest} but the latest issue digest is ${incoming.promptImport.promptDigest}`)
    }
    return
  }
  if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
    throw new ValidationError(`GitHub issue ${incoming.repoOwner}/${incoming.repoName}#${incoming.issueNumber} is already imported as spec ${specId} task ${taskId}; resolve the existing import before re-importing changed source material`)
  }
}
