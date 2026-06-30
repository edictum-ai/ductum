import type { Project, Repository, Spec, Task } from '@/api/client'

export interface SpecBrief {
  summary: string
  audience: string
  sourceLabel: string | null
  sourceUrl: string | null
  highlights: string[]
  verification: string[]
}

export function buildSpecBrief(input: {
  spec: Spec
  tasks?: Task[]
  projectName?: string
  repositories?: Repository[]
}): SpecBrief {
  const source = input.spec.source
  const summary = source == null
    ? documentSummary(input.spec.document) ?? fallbackSpecSummary(input.spec, input.projectName)
    : sourceSummary(source) ?? documentSummary(input.spec.document) ?? fallbackSpecSummary(input.spec, input.projectName)
  return {
    summary,
    audience: specAudience(input),
    sourceLabel: source == null ? null : `${source.repoOwner}/${source.repoName}#${source.issueNumber}`,
    sourceUrl: source?.issueUrl ?? null,
    highlights: sourceHighlights(source, input.spec.document),
    verification: sourceVerification(source, input.tasks ?? []),
  }
}

export function projectPurpose(project: Project, repositories: Repository[]): string {
  const explicit = cleanText(project.config.purpose)
  if (explicit != null) return explicit
  const repoNames = projectRepoNames(project, repositories)
  if (repoNames.length === 0) {
    return `Coordinate specs, tasks, attempts, review, and approvals for ${project.name}.`
  }
  return `Coordinate governed agent work across ${formatNameList(repoNames)}.`
}

export function projectAudience(project: Project, repositories: Repository[]): string {
  const explicit = cleanText(project.config.audience)
  if (explicit != null) return explicit
  const repoNames = projectRepoNames(project, repositories)
  if (repoNames.length === 0) {
    return `Developers, reviewers, and operators working on ${project.name}.`
  }
  return `Developers, reviewers, and operators responsible for ${formatNameList(repoNames)}.`
}

function sourceSummary(source: NonNullable<Spec['source']>): string | null {
  if ('parsed' in source) return cleanText(source.parsed.objective) ?? cleanText(source.title)
  return documentSummary(source.promptImport.implementation.body) ?? cleanText(source.title)
}

function sourceHighlights(source: Spec['source'] | null | undefined, document: string): string[] {
  if (source != null && 'parsed' in source) {
    return takeUseful([
      ...source.parsed.requirements,
      ...source.parsed.acceptanceCriteria.map((item) => `Accept when ${lowercaseFirst(item)}`),
    ], 4)
  }
  return extractMarkdownSection(document, ['requirements', 'acceptance criteria', 'acceptance', 'scope'], 4)
}

function sourceVerification(source: Spec['source'] | null | undefined, tasks: Task[]): string[] {
  if (source != null && 'parsed' in source) return takeUseful(source.parsed.verificationCommands, 3)
  return takeUseful(tasks.flatMap((task) => task.verification), 3)
}

function specAudience(input: {
  spec: Spec
  tasks?: Task[]
  projectName?: string
  repositories?: Repository[]
}): string {
  const source = input.spec.source
  if (source != null) return `Maintainers and reviewers for ${source.repoOwner}/${source.repoName}.`
  const taskRepos = unique((input.tasks ?? []).flatMap((task) => task.repos).map(lastPathSegment).filter(Boolean))
  if (taskRepos.length > 0) return `Developers and reviewers working in ${formatNameList(taskRepos)}.`
  const repoNames = unique((input.repositories ?? []).map((repo) => repo.name).filter(Boolean))
  if (repoNames.length > 0) return `Developers and reviewers working in ${formatNameList(repoNames)}.`
  return input.projectName == null
    ? 'Developers, reviewers, and operators using this factory.'
    : `Developers, reviewers, and operators working on ${input.projectName}.`
}

function fallbackSpecSummary(_spec: Spec, _projectName?: string): string {
  return 'Objective missing. Open the source spec before dispatching or approving this work.'
}

function documentSummary(markdown: string): string | null {
  return prefixedSummaryParagraph(markdown) ?? firstUsefulParagraph(markdown)
}

function prefixedSummaryParagraph(markdown: string): string | null {
  const lines = stripFrontMatter(markdown).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeMarkdownLine(lines[index] ?? '')
    const match = /^(?:in one sentence|summary|objective):\s*(.*)$/i.exec(line)
    if (match == null) continue
    const paragraph = [match[1] ?? '']
    for (const next of lines.slice(index + 1)) {
      const normalized = normalizeMarkdownLine(next)
      if (normalized === '' || next.trim().startsWith('#')) break
      paragraph.push(normalized)
    }
    const cleaned = cleanText(paragraph.join(' '))
    if (cleaned != null && isUsefulText(cleaned)) return cleaned
  }
  return null
}

function firstUsefulParagraph(markdown: string): string | null {
  const lines = stripFrontMatter(markdown).split('\n')
  const paragraphs: string[] = []
  let current: string[] = []
  for (const rawLine of lines) {
    const line = normalizeMarkdownLine(rawLine)
    if (line === '') {
      pushParagraph(paragraphs, current)
      current = []
      continue
    }
    if (current.length === 0 && rawLine.trim().startsWith('#')) continue
    if (isSectionHeading(line) && current.length === 0) continue
    current.push(line)
  }
  pushParagraph(paragraphs, current)
  return paragraphs.find((paragraph) => isUsefulText(paragraph)) ?? null
}

function extractMarkdownSection(markdown: string, headings: string[], limit: number): string[] {
  const lines = stripFrontMatter(markdown).split('\n')
  const results: string[] = []
  let collecting = false
  for (const rawLine of lines) {
    const normalized = normalizeMarkdownLine(rawLine)
    const heading = normalized.replace(/:$/, '').toLowerCase()
    if (isSectionHeading(normalized)) {
      collecting = headings.includes(heading.replace(/^#+\s*/, ''))
      continue
    }
    if (!collecting) continue
    const item = normalized.replace(/^[-*]\s+/, '')
    if (isUsefulText(item)) results.push(item)
    if (results.length >= limit) break
  }
  return unique(results)
}

function stripFrontMatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

function normalizeMarkdownLine(rawLine: string): string {
  return rawLine
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function pushParagraph(paragraphs: string[], lines: string[]): void {
  const paragraph = cleanText(lines.join(' '))
  if (paragraph != null) paragraphs.push(truncateSentence(paragraph, 220))
}

function isSectionHeading(line: string): boolean {
  const normalized = line.replace(/:$/, '').toLowerCase()
  return line.endsWith(':') || COMMON_HEADINGS.has(normalized)
}

const COMMON_HEADINGS = new Set([
  'summary',
  'objective',
  'requirements',
  'acceptance',
  'acceptance criteria',
  'verification',
  'out of scope',
  'safety notes',
])

function isUsefulText(value: string): boolean {
  const text = value.trim()
  if (text.length < 12) return false
  if (/^\[redacted\]$/i.test(text)) return false
  if ((text.match(/\[redacted\]/gi)?.length ?? 0) > 0 && text.replace(/\[redacted\]/gi, '').trim().length < 18) {
    return false
  }
  return /[a-z]/i.test(text)
}

function takeUseful(values: string[], limit: number): string[] {
  return unique(values.map(cleanText).filter((value): value is string => value != null && isUsefulText(value)))
    .slice(0, limit)
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed == null || trimmed === '' ? null : truncateSentence(trimmed, 240)
}

function truncateSentence(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const slice = value.slice(0, maxLength - 1)
  const sentenceEnd = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf(';'), slice.lastIndexOf(','))
  return `${slice.slice(0, sentenceEnd > 80 ? sentenceEnd : slice.length).trim()}...`
}

function lowercaseFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase() ?? ''}${value.slice(1)}`
}

function projectRepoNames(project: Project, repositories: Repository[]): string[] {
  const names = repositories.length > 0 ? repositories.map((repo) => repo.name) : project.repos.map(lastPathSegment)
  return unique(names.filter(Boolean))
}

function lastPathSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '')
  return normalized.split('/').pop() ?? normalized
}

function formatNameList(values: string[]): string {
  const visible = values.slice(0, 3)
  const suffix = values.length > visible.length ? ` and ${values.length - visible.length} more` : ''
  return `${visible.join(', ')}${suffix}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
