import type { GitHubIssueParsedFields } from '@ductum/core'

const LEGACY_SECTION_LABELS = {
  problem: 'Problem',
  desiredOutcome: 'Desired outcome',
  expectedFix: 'Expected fix',
  acceptance: 'Acceptance',
} as const

const DEFAULT_VERIFICATION_COMMANDS = [
  'pnpm build',
  'pnpm test',
  'git diff --check',
  'node scripts/check-file-size.mjs',
] as const

export interface LegacyGitHubIssueSections {
  problem: string
  outcome: string
  acceptance: string
}

export function parseLegacyGitHubIssueSections(body: string): LegacyGitHubIssueSections | null {
  const sections = parseSections(body)
  const problem = sections.get(LEGACY_SECTION_LABELS.problem)
  const outcome = sections.get(LEGACY_SECTION_LABELS.desiredOutcome)
    ?? sections.get(LEGACY_SECTION_LABELS.expectedFix)
  const acceptance = sections.get(LEGACY_SECTION_LABELS.acceptance)
  if (problem == null || outcome == null || acceptance == null) return null
  return { problem, outcome, acceptance }
}

export function buildLegacyGitHubIssueParsedFields(input: {
  body: string
  title: string
  labels: string[]
}): GitHubIssueParsedFields | null {
  const sections = parseLegacyGitHubIssueSections(input.body)
  if (sections == null) return null
  const area = deriveArea(input.title)
  return {
    workType: deriveWorkType(input.title),
    priority: derivePriority(input.labels),
    area,
    blockers: [],
    objective: firstParagraph(sections.outcome) ?? sections.outcome.trim(),
    evidence: [
      'Legacy migrated GitHub issue imported from markdown headings.',
      `Problem summary: ${firstParagraph(sections.problem) ?? sections.problem.trim()}`,
    ],
    requirements: [
      `Address the documented problem: ${firstParagraph(sections.problem) ?? sections.problem.trim()}`,
      ...toChecklist(sections.outcome),
    ],
    outOfScope: ['None specified in this legacy migrated GitHub issue.'],
    acceptanceCriteria: toChecklist(sections.acceptance),
    verificationCommands: [...DEFAULT_VERIFICATION_COMMANDS],
    safetyNotes: ['Fail closed if the legacy issue body is incomplete or ambiguous.'],
    ...(area === 'legacy backlog' ? {} : { suggestedBranch: `fix/${slugify(area)}` }),
    ductumHints: 'Legacy migrated issue imported without the structured Ductum issue form; inspect the original GitHub issue body for extra context before broad refactors.',
  }
}

function parseSections(body: string): Map<string, string> {
  const normalized = body.replace(/\r\n/g, '\n')
  const sections = new Map<string, string>()
  let currentLabel: string | null = null
  let buffer: string[] = []
  for (const line of normalized.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading != null) {
      if (currentLabel != null) sections.set(currentLabel, cleanupSection(buffer.join('\n')))
      currentLabel = heading[1]!.trim()
      buffer = []
      continue
    }
    if (currentLabel != null) buffer.push(line)
  }
  if (currentLabel != null) sections.set(currentLabel, cleanupSection(buffer.join('\n')))
  return sections
}

function cleanupSection(value: string): string {
  return value.trim()
}

function firstParagraph(value: string): string | null {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .find((part) => part !== '') ?? null
}

function toChecklist(value: string): string[] {
  const markdownList = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/^\[(?: |x|X)\]\s+/, '').trim())
    .filter((line) => line !== '')
  if (markdownList.length > 1) return markdownList
  const paragraph = firstParagraph(value)
  return paragraph == null ? [] : [paragraph]
}

function deriveWorkType(title: string): string {
  const normalized = title.trim().toLowerCase()
  if (normalized.startsWith('fix(') || normalized.startsWith('fix:')) return 'Bug fix'
  if (normalized.startsWith('feat(') || normalized.startsWith('feat:')) return 'Feature'
  if (normalized.startsWith('docs(') || normalized.startsWith('docs:')) return 'Docs'
  return 'Legacy migrated issue'
}

function derivePriority(labels: string[]): string {
  return labels.find((label) => /^p\d\b/i.test(label.trim()))
    ?? labels.find((label) => /^priority:/i.test(label.trim()))
    ?? 'Unspecified legacy priority'
}

function deriveArea(title: string): string {
  const scoped = title.match(/^[^(]+\(([^)]+)\):/)
  if (scoped?.[1] != null && scoped[1].trim() !== '') return scoped[1].trim()
  const prefixed = title.match(/^([^:]+):/)
  if (prefixed?.[1] != null && prefixed[1].trim() !== '') return prefixed[1].trim()
  return 'legacy backlog'
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
