import type { GitHubIssueParsedFields } from '@ductum/core'

import { ValidationError } from './errors.js'

const SECTION_LABELS = {
  workType: 'Work type',
  priority: 'Priority',
  area: 'Area',
  blockers: 'Blockers',
  objective: 'Objective',
  evidence: 'Evidence and source refs',
  requirements: 'Requirements',
  outOfScope: 'Out of scope',
  acceptance: 'Acceptance criteria',
  verification: 'Verification commands',
  safety: 'Safety and rollback notes',
  suggestedBranch: 'Suggested branch',
  ductumHints: 'Ductum executor hints',
} as const

const REQUIRED_LABELS = [
  SECTION_LABELS.workType,
  SECTION_LABELS.priority,
  SECTION_LABELS.area,
  SECTION_LABELS.objective,
  SECTION_LABELS.evidence,
  SECTION_LABELS.requirements,
  SECTION_LABELS.outOfScope,
  SECTION_LABELS.acceptance,
  SECTION_LABELS.verification,
  SECTION_LABELS.safety,
] as const

export function parseDuctumIssueForm(body: string): GitHubIssueParsedFields {
  const sections = parseSections(body)
  for (const label of REQUIRED_LABELS) {
    const value = sections.get(label)
    if (value == null || value.trim() === '') {
      throw new ValidationError(`GitHub issue form is missing required field: ${label}`)
    }
  }

  return {
    workType: requiredSection(sections, SECTION_LABELS.workType),
    priority: requiredSection(sections, SECTION_LABELS.priority),
    area: requiredSection(sections, SECTION_LABELS.area),
    blockers: parseCheckedBoxes(sections.get(SECTION_LABELS.blockers) ?? ''),
    objective: requiredSection(sections, SECTION_LABELS.objective),
    evidence: parseMarkdownList(requiredSection(sections, SECTION_LABELS.evidence)),
    requirements: parseMarkdownList(requiredSection(sections, SECTION_LABELS.requirements)),
    outOfScope: parseMarkdownList(requiredSection(sections, SECTION_LABELS.outOfScope)),
    acceptanceCriteria: parseMarkdownList(requiredSection(sections, SECTION_LABELS.acceptance)),
    verificationCommands: parseCommandList(requiredSection(sections, SECTION_LABELS.verification)),
    safetyNotes: parseMarkdownList(requiredSection(sections, SECTION_LABELS.safety)),
    ...(optionalSection(sections, SECTION_LABELS.suggestedBranch) == null
      ? {}
      : { suggestedBranch: optionalSection(sections, SECTION_LABELS.suggestedBranch) }),
    ...(optionalSection(sections, SECTION_LABELS.ductumHints) == null
      ? {}
      : { ductumHints: optionalSection(sections, SECTION_LABELS.ductumHints) }),
  }
}

function parseSections(body: string): Map<string, string> {
  const normalized = body.replace(/\r\n/g, '\n')
  const sections = new Map<string, string>()
  let currentLabel: string | null = null
  let buffer: string[] = []
  for (const line of normalized.split('\n')) {
    const heading = line.match(/^###\s+(.+)$/)
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
  return value
    .replace(/^_No response_\s*$/gim, '')
    .trim()
}

function requiredSection(sections: Map<string, string>, label: string): string {
  const value = optionalSection(sections, label)
  if (value == null) throw new ValidationError(`GitHub issue form is missing required field: ${label}`)
  return value
}

function optionalSection(sections: Map<string, string>, label: string): string | null {
  const value = sections.get(label)?.trim()
  return value == null || value === '' ? null : value
}

function parseCheckedBoxes(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.match(/^- \[(x|X)\]\s+(.+)$/)?.[2]?.trim() ?? null)
    .filter((line): line is string => line != null && line !== '')
}

function parseMarkdownList(value: string): string[] {
  const lines = value.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  if (lines.length === 0) return []
  return lines.map((line) =>
    line
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^\[(?: |x|X)\]\s+/, '')
      .trim(),
  )
}

function parseCommandList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line !== '')
}
