export interface GitHubIssueParsedFields {
  workType: string
  priority: string
  area: string
  blockers: string[]
  objective: string
  evidence: string[]
  requirements: string[]
  outOfScope: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  safetyNotes: string[]
  suggestedBranch?: string | null
  ductumHints?: string | null
}

export type GitHubPromptSectionHeading = 'Implementation Prompt' | 'Execution Prompt' | 'Review Prompt'
export type GitHubPromptSectionSourceKind = 'issue-body' | 'issue-comment'

export interface GitHubIssuePromptSection {
  heading: GitHubPromptSectionHeading
  body: string
  digest: string
  sourceKind: GitHubPromptSectionSourceKind
  sourceUrl: string
  commentUrl?: string | null
}

interface GitHubIssueSourceBase {
  kind: 'github-issue'
  provider: 'github'
  repoOwner: string
  repoName: string
  issueNumber: number
  issueUrl: string
  title: string
  labels: string[]
  importedAt: string
}

export interface GitHubIssueFormSource extends GitHubIssueSourceBase {
  formId: 'ductum-work-item'
  parsed: GitHubIssueParsedFields
}

export interface GitHubIssuePromptSource extends GitHubIssueSourceBase {
  promptImport: {
    mode: 'prompt-sections'
    promptDigest: string
    reviewPromptRoutedToTask: boolean
    implementation: GitHubIssuePromptSection
    review: GitHubIssuePromptSection
  }
}

export type GitHubIssueSource = GitHubIssueFormSource | GitHubIssuePromptSource
export type WorkItemSource = GitHubIssueSource

export function serializeWorkItemSource(source: WorkItemSource | null | undefined): string | null {
  return source == null ? null : JSON.stringify(source)
}

export function parseWorkItemSource(value: string | null | undefined): WorkItemSource | null {
  if (value == null || value.trim() === '') return null
  try {
    return normalizeWorkItemSource(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

export function normalizeWorkItemSource(value: unknown): WorkItemSource | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!isBaseGitHubIssueSource(source)) return null
  if ('parsed' in source && source.formId === 'ductum-work-item') return normalizeFormSource(source)
  if ('promptImport' in source) return normalizePromptSource(source)
  return null
}

export function isGitHubIssuePromptSource(source: WorkItemSource | null | undefined): source is GitHubIssuePromptSource {
  return source?.kind === 'github-issue' && 'promptImport' in source
}

function isBaseGitHubIssueSource(source: Record<string, unknown>): boolean {
  return source.kind === 'github-issue'
    && source.provider === 'github'
    && typeof source.repoOwner === 'string'
    && typeof source.repoName === 'string'
    && typeof source.issueNumber === 'number'
    && typeof source.issueUrl === 'string'
    && typeof source.title === 'string'
    && Array.isArray(source.labels)
    && typeof source.importedAt === 'string'
}

function normalizeFormSource(source: Record<string, unknown>): GitHubIssueFormSource | null {
  const parsed = source.parsed
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const fields = parsed as Record<string, unknown>
  const listFields = [
    'blockers',
    'evidence',
    'requirements',
    'outOfScope',
    'acceptanceCriteria',
    'verificationCommands',
    'safetyNotes',
  ]
  if (
    typeof fields.workType !== 'string'
    || typeof fields.priority !== 'string'
    || typeof fields.area !== 'string'
    || typeof fields.objective !== 'string'
    || listFields.some((key) => !Array.isArray(fields[key]) || (fields[key] as unknown[]).some((item) => typeof item !== 'string'))
  ) {
    return null
  }
  return {
    kind: 'github-issue',
    provider: 'github',
    repoOwner: source.repoOwner as string,
    repoName: source.repoName as string,
    issueNumber: source.issueNumber as number,
    issueUrl: source.issueUrl as string,
    title: source.title as string,
    labels: coerceStringList(source.labels),
    importedAt: source.importedAt as string,
    formId: 'ductum-work-item',
    parsed: {
      workType: fields.workType,
      priority: fields.priority,
      area: fields.area,
      blockers: coerceStringList(fields.blockers),
      objective: fields.objective,
      evidence: coerceStringList(fields.evidence),
      requirements: coerceStringList(fields.requirements),
      outOfScope: coerceStringList(fields.outOfScope),
      acceptanceCriteria: coerceStringList(fields.acceptanceCriteria),
      verificationCommands: coerceStringList(fields.verificationCommands),
      safetyNotes: coerceStringList(fields.safetyNotes),
      ...(typeof fields.suggestedBranch === 'string' ? { suggestedBranch: fields.suggestedBranch } : {}),
      ...(typeof fields.ductumHints === 'string' ? { ductumHints: fields.ductumHints } : {}),
    },
  }
}

function normalizePromptSource(source: Record<string, unknown>): GitHubIssuePromptSource | null {
  const promptImport = source.promptImport
  if (promptImport == null || typeof promptImport !== 'object' || Array.isArray(promptImport)) return null
  const parsed = promptImport as Record<string, unknown>
  if (
    parsed.mode !== 'prompt-sections'
    || typeof parsed.promptDigest !== 'string'
    || typeof parsed.reviewPromptRoutedToTask !== 'boolean'
  ) {
    return null
  }
  const implementation = normalizePromptSection(parsed.implementation)
  const review = normalizePromptSection(parsed.review)
  if (implementation == null || review == null) return null
  return {
    kind: 'github-issue',
    provider: 'github',
    repoOwner: source.repoOwner as string,
    repoName: source.repoName as string,
    issueNumber: source.issueNumber as number,
    issueUrl: source.issueUrl as string,
    title: source.title as string,
    labels: coerceStringList(source.labels),
    importedAt: source.importedAt as string,
    promptImport: {
      mode: 'prompt-sections',
      promptDigest: parsed.promptDigest,
      reviewPromptRoutedToTask: parsed.reviewPromptRoutedToTask,
      implementation,
      review,
    },
  }
}

function normalizePromptSection(value: unknown): GitHubIssuePromptSection | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const section = value as Record<string, unknown>
  if (
    !isPromptHeading(section.heading)
    || typeof section.body !== 'string'
    || typeof section.digest !== 'string'
    || !isPromptSourceKind(section.sourceKind)
    || typeof section.sourceUrl !== 'string'
  ) {
    return null
  }
  return {
    heading: section.heading,
    body: section.body,
    digest: section.digest,
    sourceKind: section.sourceKind,
    sourceUrl: section.sourceUrl,
    ...(typeof section.commentUrl === 'string' ? { commentUrl: section.commentUrl } : {}),
  }
}

function isPromptHeading(value: unknown): value is GitHubPromptSectionHeading {
  return value === 'Implementation Prompt' || value === 'Execution Prompt' || value === 'Review Prompt'
}

function isPromptSourceKind(value: unknown): value is GitHubPromptSectionSourceKind {
  return value === 'issue-body' || value === 'issue-comment'
}

function coerceStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
