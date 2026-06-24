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

export interface GitHubIssueSource {
  kind: 'github-issue'
  provider: 'github'
  repoOwner: string
  repoName: string
  issueNumber: number
  issueUrl: string
  title: string
  labels: string[]
  importedAt: string
  formId: 'ductum-work-item'
  parsed: GitHubIssueParsedFields
}

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
  if (
    source.kind !== 'github-issue'
    || source.provider !== 'github'
    || typeof source.repoOwner !== 'string'
    || typeof source.repoName !== 'string'
    || typeof source.issueNumber !== 'number'
    || typeof source.issueUrl !== 'string'
    || typeof source.title !== 'string'
    || !Array.isArray(source.labels)
    || typeof source.importedAt !== 'string'
    || source.formId !== 'ductum-work-item'
  ) {
    return null
  }
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
    repoOwner: source.repoOwner,
    repoName: source.repoName,
    issueNumber: source.issueNumber,
    issueUrl: source.issueUrl,
    title: source.title,
    labels: source.labels.filter((label): label is string => typeof label === 'string'),
    importedAt: source.importedAt,
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

function coerceStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
